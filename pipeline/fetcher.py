"""fetcher —— 采集日 K 行情 + 股本/流通股 + ST/退市/停牌状态。

数据源优先级：baostock（稳定、含复权因子与停牌标记）为主，akshare 为可选补充。
本环境网络可能受限，所以：
- 真实抓取走 `BaostockFetcher`（惰性 import baostock，未安装时给出清晰报错）。
- 离线 / CI 走 `MockFetcher`（读 pipeline/sample_data/ 下的小样本 CSV/JSON），保证 pytest 无外网可跑通。

通用能力：
- 限流（每请求最小间隔）+ 指数退避重试。
- 断点续采：以 code 为粒度把采集结果缓存到 cache_dir，已采集的 code 跳过重抓。

返回统一为 models.SecuritySeries（采集层，含身份信息，绝不进入关卡包）。
"""

from __future__ import annotations

import csv
import json
import os
import time
from abc import ABC, abstractmethod
from typing import Callable, List, Optional, TypeVar

from .models import RawBar, SecurityMeta, SecuritySeries

T = TypeVar("T")


def _retry(
    fn: Callable[[], T],
    *,
    retries: int = 3,
    base_delay: float = 0.5,
    backoff: float = 2.0,
    on_error: Optional[Callable[[int, Exception], None]] = None,
) -> T:
    """指数退避重试。最后一次失败抛出原异常。"""
    attempt = 0
    while True:
        try:
            return fn()
        except Exception as exc:  # noqa: BLE001 — 采集层需吞所有异常做重试
            attempt += 1
            if on_error:
                on_error(attempt, exc)
            if attempt > retries:
                raise
            time.sleep(base_delay * (backoff ** (attempt - 1)))


class RateLimiter:
    """简单限流：保证两次调用之间至少间隔 min_interval 秒。"""

    def __init__(self, min_interval: float = 0.0) -> None:
        self.min_interval = min_interval
        self._last = 0.0

    def wait(self) -> None:
        if self.min_interval <= 0:
            return
        now = time.monotonic()
        delta = now - self._last
        if delta < self.min_interval:
            time.sleep(self.min_interval - delta)
        self._last = time.monotonic()


class BaseFetcher(ABC):
    """采集器基类，封装断点续采缓存。"""

    def __init__(self, cache_dir: Optional[str] = None) -> None:
        self.cache_dir = cache_dir
        if cache_dir:
            os.makedirs(cache_dir, exist_ok=True)

    # -- 断点续采缓存 ---------------------------------------------------------

    def _cache_path(self, code: str) -> Optional[str]:
        if not self.cache_dir:
            return None
        safe = code.replace(".", "_").replace("/", "_")
        return os.path.join(self.cache_dir, f"{safe}.json")

    def _load_cache(self, code: str) -> Optional[SecuritySeries]:
        path = self._cache_path(code)
        if not path or not os.path.exists(path):
            return None
        with open(path, "r", encoding="utf-8") as f:
            obj = json.load(f)
        return _series_from_dict(obj)

    def _save_cache(self, series: SecuritySeries) -> None:
        path = self._cache_path(series.meta.code)
        if not path:
            return
        with open(path, "w", encoding="utf-8") as f:
            json.dump(_series_to_dict(series), f, ensure_ascii=False, indent=2)

    def fetch(self, code: str, start: str, end: str, *, use_cache: bool = True) -> SecuritySeries:
        """采集单只股票区间日 K。断点续采：缓存命中直接返回。"""
        if use_cache:
            cached = self._load_cache(code)
            if cached is not None:
                return cached
        series = self._fetch_impl(code, start, end)
        self._save_cache(series)
        return series

    def fetch_many(
        self, codes: List[str], start: str, end: str, *, use_cache: bool = True
    ) -> List[SecuritySeries]:
        out: List[SecuritySeries] = []
        for code in codes:
            out.append(self.fetch(code, start, end, use_cache=use_cache))
        return out

    @abstractmethod
    def _fetch_impl(self, code: str, start: str, end: str) -> SecuritySeries:
        ...


# ----------------------------------------------------------------- 真实采集（baostock）


class BaostockFetcher(BaseFetcher):
    """baostock 采集器。惰性登录/登出，限流 + 重试。

    采集字段：date, open, high, low, close, volume, amount, tradeStatus(停牌), isST。
    复权因子由 adjuster 单独处理（这里取不复权 frequency='d', adjustflag='3' 原始价）。
    """

    def __init__(
        self,
        cache_dir: Optional[str] = None,
        min_interval: float = 0.3,
        retries: int = 3,
    ) -> None:
        super().__init__(cache_dir)
        self.limiter = RateLimiter(min_interval)
        self.retries = retries
        self._bs = None

    def _ensure_login(self):
        if self._bs is None:
            try:
                import baostock as bs  # type: ignore
            except ImportError as exc:  # pragma: no cover - 依赖未装时的明确报错
                raise RuntimeError(
                    "baostock 未安装。请 `pip install baostock`，或使用 MockFetcher（--mock）。"
                ) from exc
            res = bs.login()
            if res.error_code != "0":
                raise RuntimeError(f"baostock 登录失败: {res.error_msg}")
            self._bs = bs
        return self._bs

    def close(self) -> None:
        if self._bs is not None:
            self._bs.logout()
            self._bs = None

    def _fetch_impl(self, code: str, start: str, end: str) -> SecuritySeries:  # pragma: no cover - 需外网
        bs = self._ensure_login()

        def _query():
            self.limiter.wait()
            fields = "date,open,high,low,close,volume,amount,turn,tradestatus,isST"
            rs = bs.query_history_k_data_plus(
                code, fields, start_date=start, end_date=end, frequency="d", adjustflag="3"
            )
            if rs.error_code != "0":
                raise RuntimeError(f"baostock 查询失败 {code}: {rs.error_msg}")
            rows = []
            while rs.next():
                rows.append(rs.get_row_data())
            return rows

        rows = _retry(_query, retries=self.retries)

        bars: List[RawBar] = []
        for r in rows:
            date, o, h, l, c, vol, amt, turn, status, is_st = r
            # tradestatus: '1'=正常交易, '0'=停牌
            tradable = status == "1"
            bars.append(
                RawBar(
                    date=date,
                    open=_f(o),
                    high=_f(h),
                    low=_f(l),
                    close=_f(c),
                    volume=_f(vol),
                    amount=_f(amt) if amt else None,
                    turnover=_f(turn) if turn else None,  # baostock turn=换手率%
                    tradable=tradable,
                    is_st=is_st == "1",
                )
            )

        meta = self._fetch_meta(code)
        return SecuritySeries(meta=meta, bars=bars)

    def _fetch_meta(self, code: str) -> SecurityMeta:  # pragma: no cover - 需外网
        bs = self._ensure_login()

        def _query():
            self.limiter.wait()
            rs = bs.query_stock_basic(code=code)
            rows = []
            while rs.next():
                rows.append(rs.get_row_data())
            return rows

        rows = _retry(_query, retries=self.retries)
        name = rows[0][1] if rows else code
        return SecurityMeta(code=code, name=name)


# ----------------------------------------------------------------- 离线/Mock 采集


class MockFetcher(BaseFetcher):
    """离线采集器：从 sample_data 目录读小样本，供无外网时跑通 pytest 与端到端导出。

    样本布局（每只一个 CSV + 一个 meta.json）：
      sample_data/<code>.csv     列: date,open,high,low,close,volume,amount,tradable,is_st,is_delisted
      sample_data/<code>.meta.json  {code,name,float_shares,total_shares}
    """

    def __init__(self, sample_dir: str, cache_dir: Optional[str] = None) -> None:
        super().__init__(cache_dir)
        self.sample_dir = sample_dir

    def list_codes(self) -> List[str]:
        codes = []
        for fn in sorted(os.listdir(self.sample_dir)):
            if fn.endswith(".csv"):
                codes.append(fn[:-4])
        return codes

    def _fetch_impl(self, code: str, start: str, end: str) -> SecuritySeries:
        csv_path = os.path.join(self.sample_dir, f"{code}.csv")
        meta_path = os.path.join(self.sample_dir, f"{code}.meta.json")
        if not os.path.exists(csv_path):
            raise FileNotFoundError(f"样本不存在: {csv_path}")

        bars: List[RawBar] = []
        with open(csv_path, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                d = row["date"]
                if start and d < start:
                    continue
                if end and d > end:
                    continue
                bars.append(
                    RawBar(
                        date=d,
                        open=_f(row["open"]),
                        high=_f(row["high"]),
                        low=_f(row["low"]),
                        close=_f(row["close"]),
                        volume=_f(row["volume"]),
                        amount=_f(row.get("amount")) if row.get("amount") else None,
                        tradable=_b(row.get("tradable", "1")),
                        is_st=_b(row.get("is_st", "0")),
                        is_delisted=_b(row.get("is_delisted", "0")),
                    )
                )

        if os.path.exists(meta_path):
            with open(meta_path, "r", encoding="utf-8") as f:
                m = json.load(f)
            meta = SecurityMeta(
                code=m.get("code", code),
                name=m.get("name", code),
                float_shares=m.get("float_shares"),
                total_shares=m.get("total_shares"),
            )
        else:
            meta = SecurityMeta(code=code, name=code)

        return SecuritySeries(meta=meta, bars=bars)


# ----------------------------------------------------------------- 辅助


def _f(x) -> float:
    try:
        return float(x)
    except (TypeError, ValueError):
        return 0.0


def _b(x) -> bool:
    return str(x).strip() in ("1", "true", "True", "yes", "Y")


def _series_to_dict(series: SecuritySeries) -> dict:
    return {
        "meta": {
            "code": series.meta.code,
            "name": series.meta.name,
            "float_shares": series.meta.float_shares,
            "total_shares": series.meta.total_shares,
        },
        "bars": [
            {
                "date": b.date,
                "open": b.open,
                "high": b.high,
                "low": b.low,
                "close": b.close,
                "volume": b.volume,
                "amount": b.amount,
                "turnover": b.turnover,
                "tradable": b.tradable,
                "is_st": b.is_st,
                "is_delisted": b.is_delisted,
            }
            for b in series.bars
        ],
    }


def _series_from_dict(obj: dict) -> SecuritySeries:
    m = obj["meta"]
    meta = SecurityMeta(
        code=m["code"],
        name=m["name"],
        float_shares=m.get("float_shares"),
        total_shares=m.get("total_shares"),
    )
    bars = [
        RawBar(
            date=b["date"],
            open=b["open"],
            high=b["high"],
            low=b["low"],
            close=b["close"],
            volume=b["volume"],
            amount=b.get("amount"),
            turnover=b.get("turnover"),
            tradable=b.get("tradable", True),
            is_st=b.get("is_st", False),
            is_delisted=b.get("is_delisted", False),
        )
        for b in obj["bars"]
    ]
    return SecuritySeries(meta=meta, bars=bars)
