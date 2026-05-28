"""生成离线小样本（含身份字段，仅供 MockFetcher 读取的采集层数据）。

产出 sample_data/<code>.csv + <code>.meta.json，覆盖多种结局：
- 600001 surge   : 上涨
- 600002 crash    : 下跌
- 600003 flat     : 横盘
- 600004 normal-halt: 中段停牌 3 日后复牌
- 600005 long-halt : 末段停牌跨过窗口尾（本局不复牌）
- 600006 st        : 后半段进入 ST
- 600007 delist     : 末段退市

这些样本【含真实日期/代码/名称】，模拟真实采集结果；脱敏由 anonymizer 负责，
最终关卡包不含这些身份字段（pytest 断言）。

注意：本脚本仅用于（重）生成样本，CSV 一旦生成即提交，pytest 不依赖运行本脚本。
"""

from __future__ import annotations

import csv
import json
import math
import os
import random

HERE = os.path.dirname(os.path.abspath(__file__))


def _date_seq(start_year: int, n: int):
    """生成 n 个伪交易日（跳过周末，简化）。返回 YYYY-MM-DD 列表。"""
    import datetime

    d = datetime.date(start_year, 1, 2)
    out = []
    while len(out) < n:
        if d.weekday() < 5:  # 周一到周五
            out.append(d.isoformat())
        d += datetime.timedelta(days=1)
    return out


def _walk(rng, n, start_price, drift, vol, limit=0.1):
    """生成 n 日 OHLCV（含价格地板）。返回 list[dict]。"""
    rows = []
    prev = start_price
    for _ in range(n):
        ret = drift + vol * rng.gauss(0, 1)
        ret = max(-limit, min(limit, ret))
        close = round(max(0.5, prev * (1 + ret)), 2)
        open_ = round(max(0.5, prev * (1 + vol * rng.gauss(0, 1) * 0.3)), 2)
        hi = max(open_, close)
        lo = min(open_, close)
        high = round(hi * (1 + abs(rng.gauss(0, 1)) * vol * 0.4), 2)
        low = round(lo * (1 - abs(rng.gauss(0, 1)) * vol * 0.4), 2)
        low = round(min(low, open_, close), 2)
        high = round(max(high, open_, close), 2)
        volume = int(rng.uniform(2e6, 1.5e7))
        amount = round(volume * close, 2)
        rows.append(
            dict(open=open_, high=high, low=low, close=close, volume=volume, amount=amount)
        )
        prev = close
    return rows


def _write(code, name, rows, float_shares):
    csv_path = os.path.join(HERE, f"{code}.csv")
    with open(csv_path, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(
            f,
            fieldnames=[
                "date", "open", "high", "low", "close",
                "volume", "amount", "tradable", "is_st", "is_delisted",
            ],
        )
        w.writeheader()
        for r in rows:
            w.writerow(r)
    with open(os.path.join(HERE, f"{code}.meta.json"), "w", encoding="utf-8") as f:
        json.dump(
            {"code": code, "name": name, "float_shares": float_shares,
             "total_shares": float_shares * 1.3},
            f, ensure_ascii=False, indent=2,
        )


def gen():
    N = 70  # 比窗口长，留切片余地
    dates = _date_seq(2018, N)
    float_shares = 2.0e8

    specs = [
        ("600001", "样本涨A", dict(drift=0.025, vol=0.025)),
        ("600002", "样本跌B", dict(drift=-0.03, vol=0.03)),
        ("600003", "样本平C", dict(drift=0.0, vol=0.012)),
    ]
    for code, name, kw in specs:
        rng = random.Random(hash(code) & 0xFFFFFFFF)
        raw = _walk(rng, N, 30.0, kw["drift"], kw["vol"])
        rows = []
        for i, r in enumerate(raw):
            rows.append({"date": dates[i], **r, "tradable": 1, "is_st": 0, "is_delisted": 0})
        _write(code, name, rows, float_shares)

    # normal-halt: 中段 day 30~32 停牌（价格冻结），day33 复牌跳空
    code, name = "600004", "样本停牌D"
    rng = random.Random(4004)
    raw = _walk(rng, N, 25.0, 0.0, 0.02)
    rows = []
    frozen = None
    for i, r in enumerate(raw):
        if 30 <= i <= 32:
            p = frozen if frozen is not None else round(r["close"], 2)
            rows.append({"date": dates[i], "open": p, "high": p, "low": p, "close": p,
                         "volume": 0, "amount": 0, "tradable": 0, "is_st": 0, "is_delisted": 0})
        else:
            if i == 33:
                # 复牌跳空 -8%
                gap = round(frozen * 0.92, 2) if frozen else r["close"]
                r = dict(r)
                r["open"] = gap
                r["close"] = round(gap * 0.99, 2)
                r["low"] = round(min(r["open"], r["close"]) * 0.99, 2)
                r["high"] = round(max(r["open"], r["close"]) * 1.01, 2)
            rows.append({"date": dates[i], **r, "tradable": 1, "is_st": 0, "is_delisted": 0})
            frozen = r["close"]
    _write(code, name, rows, float_shares)

    # long-halt: day 60 起停牌直到末尾（窗口若取末段则本局不复牌）
    code, name = "600005", "样本长停E"
    rng = random.Random(5005)
    raw = _walk(rng, N, 18.0, -0.005, 0.02)
    rows = []
    frozen = None
    for i, r in enumerate(raw):
        if i >= 60:
            p = frozen if frozen is not None else round(r["close"], 2)
            rows.append({"date": dates[i], "open": p, "high": p, "low": p, "close": p,
                         "volume": 0, "amount": 0, "tradable": 0, "is_st": 0, "is_delisted": 0})
        else:
            rows.append({"date": dates[i], **r, "tradable": 1, "is_st": 0, "is_delisted": 0})
            frozen = r["close"]
    _write(code, name, rows, float_shares)

    # st: day 40 起进入 ST，涨跌幅收窄
    code, name = "600006", "样本STF"
    rng = random.Random(6006)
    rows = []
    prev = 22.0
    frozen = None
    for i in range(N):
        is_st = 1 if i >= 40 else 0
        limit = 0.05 if is_st else 0.1
        ret = (-0.01 if is_st else 0.0) + (0.025 * rng.gauss(0, 1))
        ret = max(-limit, min(limit, ret))
        close = round(max(0.5, prev * (1 + ret)), 2)
        open_ = round(max(0.5, prev * (1 + 0.01 * rng.gauss(0, 1))), 2)
        high = round(max(open_, close) * (1 + abs(rng.gauss(0, 1)) * 0.01), 2)
        low = round(min(open_, close) * (1 - abs(rng.gauss(0, 1)) * 0.01), 2)
        volume = int(rng.uniform(1e6, 8e6))
        rows.append({"date": dates[i], "open": open_, "high": high, "low": low, "close": close,
                     "volume": volume, "amount": round(volume * close, 2),
                     "tradable": 1, "is_st": is_st, "is_delisted": 0})
        prev = close
    _write(code, name, rows, float_shares)

    # delist: day 55 起退市整理（连续跌停趋零）
    code, name = "600007", "样本退市G"
    rng = random.Random(7007)
    rows = []
    prev = 15.0
    for i in range(N):
        delist = i >= 55
        if delist:
            ret = -0.05  # ST/退市限幅内连续逼近地板
            limit = 0.05
        else:
            ret = -0.01 + 0.03 * rng.gauss(0, 1)
            limit = 0.1
        ret = max(-limit, min(limit, ret))
        close = round(max(0.5, prev * (1 + ret)), 2)
        open_ = round(max(0.5, prev * (1 + 0.01 * rng.gauss(0, 1))), 2)
        high = round(max(open_, close) * 1.005, 2)
        low = round(min(open_, close) * 0.995, 2)
        volume = int(rng.uniform(0.5e6, 5e6))
        rows.append({"date": dates[i], "open": open_, "high": high, "low": low, "close": close,
                     "volume": volume, "amount": round(volume * close, 2),
                     "tradable": 1, "is_st": 1 if delist else 0,
                     "is_delisted": 1 if delist else 0})
        prev = close
    _write(code, name, rows, float_shares)

    print("samples generated in", HERE)


if __name__ == "__main__":
    gen()
