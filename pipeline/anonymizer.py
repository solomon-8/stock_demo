"""anonymizer —— 脱敏：去名称/代码/真实日期 -> 相对日序，仅留契约字段。

输入：采集层的 RawBar 序列（含 date 真实日期、所属 SecurityMeta 含 code/name）。
输出：契约层的 DayBar 序列（仅 day 相对日序 + 行情 + 指标 + tradable/priceLimit）。

脱敏不变量（由本模块保证、并由 pytest 断言）：
- DayBar 不含 date / code / name / 任何绝对日期或身份字段。
- day 从 0 起、连续递增（窗口切片后由 level_builder 重新归零，这里按输入顺序归零）。
- 仅保留 src/types/contract.ts DayBar 定义的字段。

指标在脱敏前计算（需连续 close 序列），由 enrich() 在 RawBar 上算好后传入；本模块只做投影。
"""

from __future__ import annotations

from typing import List, Optional, Sequence

from . import indicators
from .models import DayBar, RawBar, SecurityMeta

# 严禁出现在产出中的身份字段名（脱敏校验白名单的补集）。
FORBIDDEN_FIELDS = frozenset(
    {"date", "code", "name", "symbol", "ticker", "isin", "datetime", "timestamp"}
)

# 契约 DayBar 允许的字段（唯一允许集合）。
ALLOWED_DAYBAR_FIELDS = frozenset(
    {
        "day",
        "open",
        "high",
        "low",
        "close",
        "volume",
        "turnover",
        "volumeRatio",
        "ma5",
        "ma10",
        "ma20",
        "macd",
        "dif",
        "dea",
        "rsi",
        "tradable",
        "priceLimit",
    }
)


def to_day_bars(
    bars: Sequence[RawBar],
    meta: Optional[SecurityMeta] = None,
    *,
    st_price_limit: float = 0.05,
) -> List[DayBar]:
    """把（复权后的）RawBar 序列脱敏为契约 DayBar 序列，并预计算全部指标。

    - 相对日序 day 从 0 起。
    - 换手率走流通股本口径（meta.float_shares）。
    - priceLimit：ST 或退市段收窄到 st_price_limit（默认 0.05），否则 None（不限制）。
      与前端 contract.ts 语义一致：null/undefined 表示不限制。
    """
    closes = [b.close for b in bars]
    volumes = [b.volume for b in bars]
    dif, dea, macd_hist = indicators.macd(closes)
    float_shares = meta.float_shares if meta else None

    out: List[DayBar] = []
    for i, b in enumerate(bars):
        if b.is_st or b.is_delisted:
            price_limit: Optional[float] = st_price_limit
        else:
            price_limit = None

        turnover = (
            0.0
            if not b.tradable
            else indicators.turnover_rate(b.volume, float_shares)
        )
        vol_ratio = 0.0 if not b.tradable else indicators.volume_ratio(volumes, i, 5)

        out.append(
            DayBar(
                day=i,
                open=b.open,
                high=b.high,
                low=b.low,
                close=b.close,
                volume=b.volume,
                tradable=b.tradable,
                turnover=turnover,
                volumeRatio=vol_ratio,
                ma5=indicators.sma(closes, i, 5),
                ma10=indicators.sma(closes, i, 10),
                ma20=indicators.sma(closes, i, 20),
                dif=dif[i],
                dea=dea[i],
                macd=macd_hist[i],
                rsi=indicators.rsi(closes, i, 14),
                priceLimit=price_limit,
            )
        )
    return out


def assert_anonymized(obj) -> None:
    """递归断言一个（将被序列化的）对象不含任何身份字段。供 exporter 与 pytest 调用。

    obj 可以是 dict / list / 标量。任何 dict key 命中 FORBIDDEN_FIELDS 即抛错。
    """
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k in FORBIDDEN_FIELDS:
                raise ValueError(f"脱敏校验失败：产出含身份字段 '{k}'")
            assert_anonymized(v)
    elif isinstance(obj, (list, tuple)):
        for item in obj:
            assert_anonymized(item)
