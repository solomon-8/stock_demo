"""脱敏单测：产出绝不含身份字段；DayBar 仅含契约字段。"""

import pytest

from pipeline import anonymizer
from pipeline.models import RawBar, SecurityMeta


def _bars(n=30, st_from=None, delist_from=None, halt_at=None):
    bars = []
    prev = 20.0
    for i in range(n):
        is_st = st_from is not None and i >= st_from
        is_del = delist_from is not None and i >= delist_from
        halted = halt_at is not None and i in halt_at
        if halted:
            bars.append(RawBar(f"2020-01-{i+1:02d}", prev, prev, prev, prev, 0,
                               tradable=False, is_st=is_st, is_delisted=is_del))
            continue
        c = round(prev * 1.01, 2)
        bars.append(RawBar(f"2020-01-{i+1:02d}", prev, c, prev, c, 1_000_000,
                           tradable=True, is_st=is_st, is_delisted=is_del))
        prev = c
    return bars


def test_daybar_only_allowed_fields():
    meta = SecurityMeta(code="sh.600000", name="浦发银行", float_shares=2e8)
    days = anonymizer.to_day_bars(_bars(30), meta)
    for d in days:
        keys = set(vars(d).keys())
        assert keys <= anonymizer.ALLOWED_DAYBAR_FIELDS, keys - anonymizer.ALLOWED_DAYBAR_FIELDS


def test_relative_day_sequence_starts_at_zero():
    days = anonymizer.to_day_bars(_bars(30), SecurityMeta(code="c", name="n", float_shares=2e8))
    assert [d.day for d in days] == list(range(30))


def test_st_day_has_price_limit_normal_day_none():
    days = anonymizer.to_day_bars(_bars(30, st_from=20),
                                  SecurityMeta(code="c", name="n", float_shares=2e8))
    assert days[19].priceLimit is None
    assert days[20].priceLimit == 0.05


def test_delist_day_has_price_limit():
    days = anonymizer.to_day_bars(_bars(30, delist_from=25),
                                  SecurityMeta(code="c", name="n", float_shares=2e8))
    assert days[25].priceLimit == 0.05


def test_turnover_uses_float_shares():
    days = anonymizer.to_day_bars(_bars(5), SecurityMeta(code="c", name="n", float_shares=2e8))
    # volume 1_000_000 / 2e8 * 100 = 0.5
    assert days[0].turnover == 0.5


def test_turnover_none_without_float_shares():
    days = anonymizer.to_day_bars(_bars(5), SecurityMeta(code="c", name="n"))
    assert days[0].turnover is None


def test_halted_day_turnover_and_volratio_zero():
    days = anonymizer.to_day_bars(_bars(30, halt_at={15}),
                                  SecurityMeta(code="c", name="n", float_shares=2e8))
    assert days[15].tradable is False
    assert days[15].turnover == 0.0
    assert days[15].volumeRatio == 0.0


def test_assert_anonymized_rejects_identity_fields():
    with pytest.raises(ValueError):
        anonymizer.assert_anonymized({"day": 0, "date": "2020-01-01"})
    with pytest.raises(ValueError):
        anonymizer.assert_anonymized({"levels": [{"code": "sh.600000"}]})
    # 干净对象不抛
    anonymizer.assert_anonymized({"day": 0, "open": 10.0, "tradable": True})
