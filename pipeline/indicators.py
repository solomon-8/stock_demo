"""indicators —— 预计算 MA5/10/20、MACD、RSI、换手率、量比、区间高低。

口径与前端种子生成器（tools/gen-seed.mjs）保持一致，便于 A↔B 数据观感统一：
- MA(n)   : 简单移动平均，不足 n 日返回 None；保留 3 位小数。
- RSI(14) : 周期内平均涨/跌幅的经典公式（非 Wilder 递归，简化均值版，与种子一致）；
            不足 period 日返回 None；avgLoss=0 -> 100；保留 2 位小数。
- MACD    : DIF=EMA12-EMA26，DEA=EMA9(DIF)，MACD=2*(DIF-DEA)；全程有值；保留 3 位小数。
- 换手率  : turnover% = volume / float_shares * 100（流通股口径）；无流通股本时退化为 None。
- 量比    : volumeRatio = 当日量 / 过去 N 日（默认 5）平均量；不足前置日返回 None；保留 2 位小数。
- 区间高低: 给定窗口内的最高 high / 最低 low / 区间涨跌幅，供 level_builder 写 reveal/标签使用。

停牌日（volume=0, tradable=False）：换手率/量比按 0 处理（与种子一致），均线/MACD/RSI 用冻结价参与。
"""

from __future__ import annotations

from typing import List, Optional, Sequence


def sma(closes: Sequence[float], idx: int, period: int) -> Optional[float]:
    if idx + 1 < period:
        return None
    window = closes[idx - period + 1 : idx + 1]
    return round(sum(window) / period, 3)


def rsi(closes: Sequence[float], idx: int, period: int = 14) -> Optional[float]:
    if idx < period:
        return None
    gain = 0.0
    loss = 0.0
    for i in range(idx - period + 1, idx + 1):
        diff = closes[i] - closes[i - 1]
        if diff >= 0:
            gain += diff
        else:
            loss -= diff
    avg_gain = gain / period
    avg_loss = loss / period
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return round(100 - 100 / (1 + rs), 2)


def ema_series(values: Sequence[float], period: int) -> List[float]:
    if not values:
        return []
    k = 2 / (period + 1)
    out = [float(values[0])]
    prev = float(values[0])
    for i in range(1, len(values)):
        prev = values[i] * k + prev * (1 - k)
        out.append(prev)
    return out


def macd(closes: Sequence[float]):
    """返回 (dif[], dea[], macd[])，与 closes 等长，均保留 3 位小数。"""
    ema12 = ema_series(closes, 12)
    ema26 = ema_series(closes, 26)
    dif = [ema12[i] - ema26[i] for i in range(len(closes))]
    dea = ema_series(dif, 9)
    macd_hist = [2 * (dif[i] - dea[i]) for i in range(len(closes))]
    return (
        [round(x, 3) for x in dif],
        [round(x, 3) for x in dea],
        [round(x, 3) for x in macd_hist],
    )


def turnover_rate(volume: float, float_shares: Optional[float]) -> Optional[float]:
    """换手率（百分比）= 成交量 / 流通股本 * 100。无流通股本返回 None。"""
    if not float_shares or float_shares <= 0:
        return None
    return round(volume / float_shares * 100, 2)


def volume_ratio(volumes: Sequence[float], idx: int, period: int = 5) -> Optional[float]:
    """量比 = 当日量 / 过去 period 日平均量。不足 period 前置日返回 None。

    停牌日量为 0，仍纳入平均（贴近真实"量能枯竭"观感）。避免除零返回 None。
    """
    if idx < period:
        return None
    window = volumes[idx - period : idx]
    avg = sum(window) / period
    if avg <= 0:
        return None
    return round(volumes[idx] / avg, 2)


def range_high_low(highs: Sequence[float], lows: Sequence[float]):
    """区间最高 high、最低 low。空序列返回 (None, None)。"""
    if not highs or not lows:
        return None, None
    return max(highs), min(lows)


def range_change_pct(closes: Sequence[float]) -> Optional[float]:
    """区间涨跌幅 % = (末收 / 首收 - 1) * 100。"""
    if len(closes) < 2 or closes[0] == 0:
        return None
    return round((closes[-1] / closes[0] - 1) * 100, 2)
