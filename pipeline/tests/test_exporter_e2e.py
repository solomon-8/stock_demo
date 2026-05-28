"""导出 + 端到端 + 契约一致性单测（用 mock 样本，无外网）。"""

import json
import os

from pipeline import adjuster, exporter, level_builder
from pipeline.fetcher import MockFetcher
from pipeline.models import (
    DayBar,
    LevelIndexEntry,
    LevelPack,
    MarketEvent,
    Reveal,
)

SAMPLE_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "sample_data")

# 契约允许字段（与 src/types/contract.ts 对齐）。
DAYBAR_ALLOWED = {
    "day", "open", "high", "low", "close", "volume", "turnover", "volumeRatio",
    "ma5", "ma10", "ma20", "macd", "dif", "dea", "rsi", "tradable", "priceLimit",
}
DAYBAR_REQUIRED = {"day", "open", "high", "low", "close", "volume", "tradable"}
EVENT_ALLOWED = {"type", "startDay", "endDay", "resumeDay"}
LEVELPACK_REQUIRED = {"levelId", "totalDays", "revealDays", "startCash", "days", "events", "reveal"}
INDEX_ENTRY_KEYS = {"levelId", "difficulty", "outcomeTags", "totalDays", "file"}
FORBIDDEN = {"date", "code", "name", "symbol", "ticker", "isin"}


def _sample_pack():
    fetcher = MockFetcher(sample_dir=SAMPLE_DIR)
    series = adjuster.back_adjust(fetcher.fetch("600001", "", ""), factors=None)
    pack, diff = level_builder.build_level(series, "level_test", start_index=0, length=40)
    return pack, diff


def test_prune_none_drops_optional_fields():
    pack, _ = _sample_pack()
    obj = exporter.level_to_dict(pack)
    # day0 无 ma5/ma10/ma20/rsi -> 应被丢弃
    d0 = obj["days"][0]
    assert "ma5" not in d0  # None 被裁剪
    assert "priceLimit" not in d0 or d0["priceLimit"] is not None


def test_levelpack_required_fields_present():
    pack, _ = _sample_pack()
    obj = exporter.level_to_dict(pack)
    assert LEVELPACK_REQUIRED <= set(obj.keys())
    assert obj["revealDays"] == 10
    assert obj["startCash"] == 100000
    assert 30 <= obj["totalDays"] <= 60
    assert len(obj["days"]) == obj["totalDays"]


def test_daybar_fields_within_contract():
    pack, _ = _sample_pack()
    obj = exporter.level_to_dict(pack)
    for d in obj["days"]:
        assert set(d.keys()) <= DAYBAR_ALLOWED, set(d.keys()) - DAYBAR_ALLOWED
        assert DAYBAR_REQUIRED <= set(d.keys())
        # OHLC 不变式
        assert d["low"] <= d["open"] <= d["high"]
        assert d["low"] <= d["close"] <= d["high"]


def test_events_fields_within_contract():
    pack, _ = _sample_pack()
    obj = exporter.level_to_dict(pack)
    for e in obj["events"]:
        assert set(e.keys()) <= EVENT_ALLOWED
        assert e["type"] in ("halt", "st", "delist")
        assert 0 <= e["startDay"] < obj["totalDays"]


def test_export_produces_index_and_files(tmp_path):
    fetcher = MockFetcher(sample_dir=SAMPLE_DIR)
    packs = []
    for i, code in enumerate(fetcher.list_codes()):
        series = adjuster.back_adjust(fetcher.fetch(code, "", ""), factors=None)
        pack, diff = level_builder.build_level(series, f"level_b{i+1:04d}", start_index=0, length=35)
        packs.append((pack, diff))
    levels_dir = str(tmp_path)
    entries = exporter.export_levels(packs, levels_dir, subdir="generated")

    idx_path = os.path.join(levels_dir, "generated", "index.json")
    assert os.path.exists(idx_path)
    index = json.load(open(idx_path, encoding="utf-8"))
    assert "levels" in index
    for entry in index["levels"]:
        assert set(entry.keys()) == INDEX_ENTRY_KEYS
        assert entry["difficulty"] in ("easy", "normal", "hard")
        # file 指向 generated 子目录，存在
        f = os.path.join(levels_dir, entry["file"])
        assert os.path.exists(f), f


def test_no_identity_fields_in_output(tmp_path):
    """脱敏核心断言：产出 JSON 文本不含任何身份字段。"""
    fetcher = MockFetcher(sample_dir=SAMPLE_DIR)
    packs = []
    for i, code in enumerate(fetcher.list_codes()):
        series = adjuster.back_adjust(fetcher.fetch(code, "", ""), factors=None)
        pack, diff = level_builder.build_level(series, f"level_b{i+1:04d}", start_index=0, length=35)
        packs.append((pack, diff))
    levels_dir = str(tmp_path)
    exporter.export_levels(packs, levels_dir, subdir="generated")

    gen_dir = os.path.join(levels_dir, "generated")
    for fn in os.listdir(gen_dir):
        text = open(os.path.join(gen_dir, fn), encoding="utf-8").read()
        for word in FORBIDDEN:
            assert f'"{word}"' not in text, (fn, word)


def test_export_does_not_touch_seed_files():
    """exporter 默认写 generated/ 子目录，不覆盖前端种子 level_*.json / index.json。"""
    assert exporter.DEFAULT_OUTPUT_SUBDIR == "generated"


def test_long_halt_window_has_no_resume_day():
    """600005 末段长停：取覆盖停牌段且到末尾的窗口 -> halt 无 resumeDay。"""
    fetcher = MockFetcher(sample_dir=SAMPLE_DIR)
    series = adjuster.back_adjust(fetcher.fetch("600005", "", ""), factors=None)
    # 样本 day>=60 停牌，共 70 日；取末段 [25, 70) 长度 45 覆盖到末尾
    pack, _ = level_builder.build_level(series, "level_lh", start_index=25, length=45)
    halts = [e for e in pack.events if e.type == "halt"]
    assert halts, "应检测到停牌段"
    assert halts[-1].resumeDay is None  # 跨过窗口尾，本局不复牌
    assert "long-halt" in pack.reveal.outcomeTags
