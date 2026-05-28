"""构建【真实退市股】关卡：取退市股生命末期窗口，并在末日标记退市，
复现真实"退市归零、永远无法翻身"的签名痛点。

baostock 的日 K 不带退市标记，故由本脚本：
1. 抓取该股全历史（含 ST / 退市整理期的连续跌停死亡螺旋）；
2. 取末尾 L(∈[30,60]) 个交易日为窗口（生命末期）；
3. 在窗口最后一日标记 is_delisted=True → level_builder 产出 delist 事件，
   引擎据此在结算时持仓归零。
脱敏不变：产出关卡不含名称/代码/日期；reveal.story 用通用戏剧化文案（不泄漏身份）。

用法：
  python3 -m pipeline.build_delisted \
    --codes sz.002680,sz.300104,sz.002450,sh.600401,sh.600145,sz.000587 \
    --out-subdir generated_real --length 55
"""

from __future__ import annotations

import argparse
import os
import sys
from typing import List, Tuple

from . import adjuster, exporter, level_builder
from .fetcher import BaostockFetcher
from .models import LevelPack

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_LEVELS_DIR = os.path.join(REPO_ROOT, "src", "assets", "levels")

# 通用、脱敏的退市揭盘文案（按出现顺序循环取用，绝不含真实名称/代码）。
DELIST_STORIES = [
    "复盘：这只股票因重大违规/财务造假被强制退市。退市整理期内连续跌停、流动性枯竭，"
    "持仓最终归零——这正是“看着曾经很美，却永远无法翻身”的真实结局。",
    "复盘：基本面崩塌后股价进入死亡螺旋，被实施退市风险警示直至摘牌。重仓押注它的人血本无归。",
    "复盘：踩雷退市。曾经的明星股因连年亏损/信披违规跌入深渊，退市整理期每日一字跌停，最终清零。",
]


def out_date(bs, code: str):
    rs = bs.query_stock_basic(code=code)
    row = None
    while rs.next():
        row = rs.get_row_data()
    return row  # [code, name, ipoDate, outDate, type, status]


def run(args: argparse.Namespace) -> int:
    codes = [c.strip() for c in args.codes.split(",") if c.strip()]
    fetcher = BaostockFetcher(cache_dir=args.cache_dir)
    bs = fetcher._ensure_login()

    packs_with_diff: List[Tuple[LevelPack, str]] = []
    for i, code in enumerate(codes):
        try:
            basic = out_date(bs, code)
            series = fetcher.fetch(code, args.start, args.end)
        except Exception as exc:  # noqa: BLE001
            print(f"[skip] 采集失败 {code}: {exc}", file=sys.stderr)
            continue

        adjusted = adjuster.back_adjust(series, factors=None)
        bars = adjusted.bars
        if len(bars) < 30:
            print(f"[skip] {code} 行情不足 30 日（{len(bars)}）", file=sys.stderr)
            continue

        L = max(30, min(args.length, 60, len(bars)))
        start = len(bars) - L  # 生命末期窗口

        # 末日标记退市（窗口最后一日）→ 触发 delist 事件、结算归零。
        bars[-1].is_delisted = True

        level_id = f"level_d{str(i + 1).zfill(4)}"
        story = DELIST_STORIES[i % len(DELIST_STORIES)]
        try:
            pack, difficulty = level_builder.build_level(
                adjusted, level_id, start_index=start, length=L, story=story
            )
        except Exception as exc:  # noqa: BLE001
            print(f"[skip] 切关卡失败 {code}: {exc}", file=sys.stderr)
            continue

        # 强制 difficulty=hard（真实退市最难），并确保 outcomeTags 含 delisted。
        if "delisted" not in pack.reveal.outcomeTags:
            pack.reveal.outcomeTags.append("delisted")
        difficulty = "hard"

        packs_with_diff.append((pack, difficulty))
        print(
            f"[ok] {level_id}  days={pack.totalDays}  tags={pack.reveal.outcomeTags}  "
            f"diff={difficulty}  (outDate={basic[3] if basic else '?'})"
        )

    fetcher.close()

    if not packs_with_diff:
        print("没有产出任何退市关卡。", file=sys.stderr)
        return 1

    entries = exporter.export_levels(packs_with_diff, args.levels_dir, args.out_subdir)
    out_dir = os.path.join(args.levels_dir, args.out_subdir)
    print(f"导出 {len(entries)} 个真实退市关卡 -> {out_dir}")
    return 0


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="pipeline.build_delisted", description="真实退市股关卡构建")
    p.add_argument("--codes", required=True, help="退市股代码，逗号分隔（baostock 格式 sh./sz.）")
    p.add_argument("--start", default="2000-01-01")
    p.add_argument("--end", default="2030-01-01")
    p.add_argument("--length", type=int, default=55, help="末期窗口长度（30~60）")
    p.add_argument("--levels-dir", default=DEFAULT_LEVELS_DIR)
    p.add_argument("--out-subdir", default="generated_real")
    p.add_argument("--cache-dir", default=None)
    return p


if __name__ == "__main__":
    raise SystemExit(run(build_arg_parser().parse_args()))
