"""后复权单测。"""

from pipeline.adjuster import back_adjust
from pipeline.models import RawBar, SecurityMeta, SecuritySeries


def _series(bars):
    return SecuritySeries(meta=SecurityMeta(code="x", name="x"), bars=bars)


def test_identity_when_no_factors():
    bars = [RawBar("2020-01-01", 10, 11, 9, 10.5, 1000)]
    out = back_adjust(_series(bars), factors=None)
    b = out.bars[0]
    assert (b.open, b.high, b.low, b.close) == (10, 11, 9, 10.5)


def test_back_adjust_scales_by_factor_ratio():
    bars = [
        RawBar("2020-01-01", 10, 10, 10, 10, 1000),
        RawBar("2020-01-02", 5, 5, 5, 5, 1000),  # 除权后腰斩
    ]
    # 复权因子：首日 1.0，次日 0.5 -> 后复权 ratio = f/base = 0.5/1.0 => 次日价 *0.5?
    # base 取首个有效因子=1.0；次日 ratio=0.5 -> 5*0.5=2.5 ...
    # 我们用因子=[1.0, 2.0] 表示次日实际价应放大 2 倍以补回除权缺口。
    out = back_adjust(_series(bars), factors=[1.0, 2.0])
    assert out.bars[0].close == 10.0  # 首日不变
    assert out.bars[1].close == 10.0  # 5 * (2.0/1.0) = 10 -> 序列连续


def test_ohlc_invariant_preserved():
    bars = [RawBar("2020-01-01", 10, 12, 8, 11, 1000)]
    out = back_adjust(_series(bars), factors=[3.0])
    b = out.bars[0]
    assert b.low <= b.open <= b.high
    assert b.low <= b.close <= b.high


def test_halted_day_frozen_and_zero_volume():
    bars = [
        RawBar("2020-01-01", 10, 10, 10, 10, 1000, tradable=True),
        RawBar("2020-01-02", 0, 0, 0, 0, 0, tradable=False),  # 停牌
        RawBar("2020-01-03", 11, 12, 10, 11, 1000, tradable=True),
    ]
    out = back_adjust(_series(bars), factors=None)
    halted = out.bars[1]
    assert halted.tradable is False
    assert halted.volume == 0
    # 价格冻结为前一交易日收盘
    assert halted.open == halted.high == halted.low == halted.close == 10.0


def test_factor_length_mismatch_raises():
    bars = [RawBar("2020-01-01", 10, 10, 10, 10, 1000)]
    try:
        back_adjust(_series(bars), factors=[1.0, 2.0])
        assert False, "应抛出长度不一致错误"
    except ValueError:
        pass
