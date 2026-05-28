"""exporter —— 产出与 src/types/contract.ts 完全一致的 LevelPack JSON + index.json。

关键点：
- dataclass -> dict 时丢弃所有 None 字段（对应 TS optional），使产出干净、与契约 optional 语义一致。
  例外：priceLimit 不限制时按契约可为 null 或省略，这里【省略】（前端按 null/undefined 同等处理）。
- 序列化前调用 anonymizer.assert_anonymized 做脱敏断言：产出绝不含 date/code/name 等身份字段。
- 默认输出目录为 src/assets/levels/generated/（子目录），不覆盖前端种子文件 level_*.json / index.json。
- index.json 的 file 字段为相对 levels 目录的路径（如 'generated/level_b0001.json'）。
"""

from __future__ import annotations

import json
import os
from dataclasses import asdict
from typing import List, Sequence

from .anonymizer import assert_anonymized
from .models import DayBar, LevelIndexEntry, LevelPack

# 相对仓库根：前端种子在 src/assets/levels/，管线产出放到其下 generated/ 子目录避免覆盖。
DEFAULT_OUTPUT_SUBDIR = "generated"


def _prune_none(obj):
    """递归丢弃 dict 中值为 None 的键；保留 list 顺序。"""
    if isinstance(obj, dict):
        return {k: _prune_none(v) for k, v in obj.items() if v is not None}
    if isinstance(obj, list):
        return [_prune_none(x) for x in obj]
    return obj


def level_to_dict(pack: LevelPack) -> dict:
    """LevelPack -> 契约 JSON dict（丢弃 None 的 optional 字段）。"""
    raw = asdict(pack)
    pruned = _prune_none(raw)
    # 脱敏断言：产出绝不含身份字段。
    assert_anonymized(pruned)
    return pruned


def index_to_dict(entries: Sequence[LevelIndexEntry]) -> dict:
    return {"levels": [_prune_none(asdict(e)) for e in entries]}


def write_level(pack: LevelPack, levels_dir: str, subdir: str = DEFAULT_OUTPUT_SUBDIR) -> str:
    """写单个关卡到 levels_dir/subdir/level_<id>.json。返回相对 levels_dir 的 file 路径。"""
    out_dir = os.path.join(levels_dir, subdir) if subdir else levels_dir
    os.makedirs(out_dir, exist_ok=True)
    filename = f"{pack.levelId}.json"
    full = os.path.join(out_dir, filename)
    with open(full, "w", encoding="utf-8") as f:
        json.dump(level_to_dict(pack), f, ensure_ascii=False, indent=2)
        f.write("\n")
    return os.path.join(subdir, filename) if subdir else filename


def write_index(entries: Sequence[LevelIndexEntry], levels_dir: str, subdir: str = DEFAULT_OUTPUT_SUBDIR) -> str:
    """写 index.json 到 levels_dir/subdir/index.json（独立索引，不覆盖前端种子 index.json）。"""
    out_dir = os.path.join(levels_dir, subdir) if subdir else levels_dir
    os.makedirs(out_dir, exist_ok=True)
    full = os.path.join(out_dir, "index.json")
    with open(full, "w", encoding="utf-8") as f:
        json.dump(index_to_dict(entries), f, ensure_ascii=False, indent=2)
        f.write("\n")
    return full


def export_levels(
    packs_with_diff: Sequence,
    levels_dir: str,
    subdir: str = DEFAULT_OUTPUT_SUBDIR,
) -> List[LevelIndexEntry]:
    """批量导出：packs_with_diff 为 [(LevelPack, difficulty), ...]，写关卡文件 + index.json。"""
    entries: List[LevelIndexEntry] = []
    for pack, difficulty in packs_with_diff:
        file_ref = write_level(pack, levels_dir, subdir)
        entries.append(
            LevelIndexEntry(
                levelId=pack.levelId,
                difficulty=difficulty,
                outcomeTags=pack.reveal.outcomeTags,
                totalDays=pack.totalDays,
                file=file_ref,
            )
        )
    write_index(entries, levels_dir, subdir)
    return entries
