"""adjuster —— 后复权处理。

为什么后复权（hou-fuquan）：除权除息日股价会"台阶式"跳水，但这不是真实涨跌，会误导玩家
对历史走势的判断。后复权以最早一日为基准向后累乘复权因子，使整段价格序列连续、可比，
且最近价保留真实量级特征（后复权 = 早期价被抬高/压低以消除除权缺口，基准在序列起点）。

口径：
- 输入每个交易日的复权因子 factor（baostock 的 query_adjust_factor 给出 adjustfactor）。
- 后复权价 = 原始价 * (factor / factor_first)，其中 factor_first 为序列首日因子。
  这样首日价不变、其后按因子比例放大，保持序列连续。
- 成交量不复权（量为真实股数；金额/换手另算）。
- 停牌日（tradable=False）价格沿用前一交易日收盘，复权后仍保持冻结一致性。

无复权因子时（如样本未提供）退化为恒等（factor=1），价格即原始价，序列仍连续可用。
"""

from __future__ import annotations

from typing import List, Optional, Sequence

from .models import RawBar, SecuritySeries


def back_adjust(
    series: SecuritySeries, factors: Optional[Sequence[float]] = None
) -> SecuritySeries:
    """对 series.bars 做后复权，返回新的 SecuritySeries（不修改入参）。

    factors: 与 bars 等长的复权因子序列；None 表示无复权（恒等）。
    """
    bars = series.bars
    n = len(bars)
    if factors is None:
        adj_factors: List[float] = [1.0] * n
    else:
        if len(factors) != n:
            raise ValueError(f"复权因子长度 {len(factors)} 与行情长度 {n} 不一致")
        adj_factors = [float(x) if x else 1.0 for x in factors]

    # 基准 = 首个有效因子，保证首日价不变、序列连续。
    base = next((f for f in adj_factors if f > 0), 1.0)

    new_bars: List[RawBar] = []
    prev_close: Optional[float] = None
    for bar, f in zip(bars, adj_factors):
        ratio = (f / base) if base else 1.0
        if not bar.tradable:
            # 停牌日：价格冻结为前一交易日复权后收盘（若有），否则用自身复权价。
            frozen = prev_close if prev_close is not None else _r(bar.close * ratio)
            new_bars.append(
                RawBar(
                    date=bar.date,
                    open=frozen,
                    high=frozen,
                    low=frozen,
                    close=frozen,
                    volume=0.0,
                    amount=0.0,
                    tradable=False,
                    is_st=bar.is_st,
                    is_delisted=bar.is_delisted,
                )
            )
            # prev_close 不变（价格冻结）
            continue

        o = _r(bar.open * ratio)
        h = _r(bar.high * ratio)
        l = _r(bar.low * ratio)
        c = _r(bar.close * ratio)
        # 保证 OHLC 不变式：low <= open/close <= high
        lo = min(o, h, l, c)
        hi = max(o, h, l, c)
        new_bars.append(
            RawBar(
                date=bar.date,
                open=o,
                high=hi,
                low=lo,
                close=c,
                volume=bar.volume,  # 量不复权
                amount=bar.amount,
                turnover=bar.turnover,  # 换手率不复权，原样保留
                tradable=True,
                is_st=bar.is_st,
                is_delisted=bar.is_delisted,
            )
        )
        prev_close = c

    return SecuritySeries(meta=series.meta, bars=new_bars)


def _r(x: float) -> float:
    return round(float(x), 2)
