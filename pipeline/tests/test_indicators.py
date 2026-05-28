"""指标计算单测（口径与 tools/gen-seed.mjs 一致）。"""

from pipeline import indicators


def test_sma_insufficient_returns_none():
    closes = [1, 2, 3]
    assert indicators.sma(closes, 1, 5) is None  # idx+1 < period


def test_sma_value():
    closes = [10, 12, 14, 16, 18]
    # MA5 在 idx=4 = 平均(10..18)=14
    assert indicators.sma(closes, 4, 5) == 14.0


def test_rsi_all_gains_is_100():
    closes = list(range(1, 30))  # 单调上涨 -> avg_loss=0 -> 100
    assert indicators.rsi(closes, 20, 14) == 100.0


def test_rsi_insufficient_none():
    closes = [1, 2, 3]
    assert indicators.rsi(closes, 2, 14) is None


def test_rsi_range():
    closes = [10, 11, 10, 12, 11, 13, 12, 14, 13, 15, 14, 16, 15, 17, 16]
    r = indicators.rsi(closes, 14, 14)
    assert r is not None and 0 <= r <= 100


def test_macd_lengths_and_full_values():
    closes = [float(i) for i in range(1, 50)]
    dif, dea, macd = indicators.macd(closes)
    assert len(dif) == len(dea) == len(macd) == len(closes)
    # 持续上涨 -> dif 应为正
    assert dif[-1] > 0


def test_turnover_rate():
    # volume / float_shares * 100
    assert indicators.turnover_rate(2_000_000, 200_000_000) == 1.0
    assert indicators.turnover_rate(2_000_000, None) is None
    assert indicators.turnover_rate(2_000_000, 0) is None


def test_volume_ratio():
    vols = [100, 100, 100, 100, 100, 200]
    # idx=5: 当日200 / 过去5日均值100 = 2.0
    assert indicators.volume_ratio(vols, 5, 5) == 2.0
    assert indicators.volume_ratio(vols, 2, 5) is None  # 不足前置日


def test_volume_ratio_zero_avg_none():
    vols = [0, 0, 0, 0, 0, 50]
    assert indicators.volume_ratio(vols, 5, 5) is None


def test_range_high_low_and_change():
    highs = [10, 12, 9, 15]
    lows = [8, 7, 6, 11]
    hi, lo = indicators.range_high_low(highs, lows)
    assert hi == 15 and lo == 6
    assert indicators.range_change_pct([10, 12]) == 20.0
    assert indicators.range_change_pct([10, 8]) == -20.0
