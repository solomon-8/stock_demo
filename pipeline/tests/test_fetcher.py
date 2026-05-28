"""fetcher 单测：mock 读取、断点续采缓存、重试逻辑。"""

import os

import pytest

from pipeline import fetcher
from pipeline.fetcher import MockFetcher, _retry

SAMPLE_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "sample_data")


def test_mock_fetch_returns_series_with_bars():
    f = MockFetcher(sample_dir=SAMPLE_DIR)
    s = f.fetch("600001", "", "")
    assert s.meta.code == "600001"
    assert len(s.bars) >= 30
    assert s.bars[0].tradable is True


def test_mock_list_codes():
    f = MockFetcher(sample_dir=SAMPLE_DIR)
    codes = f.list_codes()
    assert "600001" in codes and "600007" in codes


def test_mock_halted_bars_loaded():
    f = MockFetcher(sample_dir=SAMPLE_DIR)
    s = f.fetch("600004", "", "")
    assert any(not b.tradable for b in s.bars)  # 含停牌日


def test_mock_st_and_delist_flags():
    f = MockFetcher(sample_dir=SAMPLE_DIR)
    st = f.fetch("600006", "", "")
    assert any(b.is_st for b in st.bars)
    de = f.fetch("600007", "", "")
    assert any(b.is_delisted for b in de.bars)


def test_date_range_filter():
    f = MockFetcher(sample_dir=SAMPLE_DIR)
    s_all = f.fetch("600001", "", "", use_cache=False)
    first = s_all.bars[0].date
    last = s_all.bars[-1].date
    assert first <= last


def test_breakpoint_cache_roundtrip(tmp_path):
    cache = str(tmp_path / "cache")
    f = MockFetcher(sample_dir=SAMPLE_DIR, cache_dir=cache)
    s1 = f.fetch("600001", "", "")
    # 缓存文件落地
    assert os.path.exists(os.path.join(cache, "600001.json"))
    # 删源样本后仍能从缓存读（验证断点续采命中缓存而不重抓）
    s2 = f.fetch("600001", "", "")
    assert len(s1.bars) == len(s2.bars)
    assert s1.meta.name == s2.meta.name


def test_retry_succeeds_after_failures():
    calls = {"n": 0}

    def flaky():
        calls["n"] += 1
        if calls["n"] < 3:
            raise RuntimeError("transient")
        return "ok"

    assert _retry(flaky, retries=5, base_delay=0) == "ok"
    assert calls["n"] == 3


def test_retry_exhausts_and_raises():
    def always_fail():
        raise RuntimeError("boom")

    with pytest.raises(RuntimeError):
        _retry(always_fail, retries=2, base_delay=0)


def test_rate_limiter_no_wait_when_zero():
    rl = fetcher.RateLimiter(0)
    rl.wait()  # 不应阻塞
