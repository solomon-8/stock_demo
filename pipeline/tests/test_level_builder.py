"""切关卡 + 事件检测 + 标签单测。"""

import random

from pipeline import level_builder
from pipeline.models import RawBar, SecurityMeta, SecuritySeries


def _series(bars):
    return SecuritySeries(meta=SecurityMeta(code="c", name="n", float_shares=2e8), bars=bars)


def _trend_bars(n, ret):
    bars = []
    prev = 20.0
    for i in range(n):
        c = round(max(0.5, prev * (1 + ret)), 2)
        bars.append(RawBar(f"d{i}", prev, max(prev, c), min(prev, c), c, 1_000_000))
        prev = c
    return bars


def test_detect_halt_with_resume():
    bars = _trend_bars(40, 0.0)
    for i in (20, 21, 22):
        bars[i] = RawBar(f"d{i}", 20, 20, 20, 20, 0, tradable=False)
    events = level_builder.detect_halt_events(bars)
    assert len(events) == 1
    e = events[0]
    assert e.type == "halt" and e.startDay == 20 and e.endDay == 22 and e.resumeDay == 23


def test_detect_long_halt_no_resume():
    bars = _trend_bars(40, 0.0)
    for i in range(37, 40):  # 停牌到窗口末尾
        bars[i] = RawBar(f"d{i}", 20, 20, 20, 20, 0, tradable=False)
    events = level_builder.detect_halt_events(bars)
    assert events[0].resumeDay is None  # 本局不复牌


def test_detect_st_and_delist():
    bars = _trend_bars(40, -0.01)
    for i in range(30, 40):
        bars[i].is_st = True
    for i in range(35, 40):
        bars[i].is_delisted = True
    assert level_builder.detect_st_event(bars).startDay == 30
    assert level_builder.detect_delist_event(bars).startDay == 35


def test_classify_surge():
    bars = _trend_bars(40, 0.02)  # 持续上涨
    tags, diff = level_builder.classify(bars, [])
    assert "surge" in tags and diff == "easy"


def test_classify_crash():
    bars = _trend_bars(40, -0.03)
    tags, _ = level_builder.classify(bars, [])
    assert "crash" in tags


def test_classify_flat():
    bars = _trend_bars(40, 0.0)
    tags, diff = level_builder.classify(bars, [])
    assert "flat" in tags and diff == "easy"


def test_classify_delist_priority():
    bars = _trend_bars(40, -0.02)
    from pipeline.models import MarketEvent
    events = [MarketEvent(type="delist", startDay=35, endDay=39)]
    tags, diff = level_builder.classify(bars, events)
    assert "delisted" in tags and diff == "hard"


def test_build_level_window_bounds():
    bars = _trend_bars(70, 0.01)
    rng = random.Random(1)
    pack, diff = level_builder.build_level(_series(bars), "level_t1", rng=rng)
    assert 30 <= pack.totalDays <= 60
    assert pack.totalDays == len(pack.days)
    assert pack.revealDays == 10
    assert pack.startCash == 100000
    assert [d.day for d in pack.days] == list(range(pack.totalDays))


def test_build_level_fixed_window():
    bars = _trend_bars(70, 0.0)
    pack, _ = level_builder.build_level(_series(bars), "level_t2",
                                        start_index=5, length=40)
    assert pack.totalDays == 40


def test_build_level_too_short_raises():
    bars = _trend_bars(20, 0.0)
    try:
        level_builder.build_level(_series(bars), "level_t3", length=30)
        assert False
    except ValueError:
        pass
