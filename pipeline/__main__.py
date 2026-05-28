"""管线入口：采集 -> 复权 -> 脱敏 -> 指标 -> 切关卡 -> 导出。

用法：
  python -m pipeline --mock                 # 离线：用 sample_data 小样本跑通端到端导出
  python -m pipeline --mock --out-subdir generated
  python -m pipeline --codes sh.600000,sz.000001 --start 2018-01-01 --end 2020-12-31
                                            # 真实：baostock 采集（需安装 baostock + 外网）

默认产出到 src/assets/levels/generated/（子目录，不覆盖前端种子）。
"""

from __future__ import annotations

import argparse
import os
import random
import sys
from typing import List

from . import adjuster, exporter, level_builder
from .fetcher import BaostockFetcher, MockFetcher

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_LEVELS_DIR = os.path.join(REPO_ROOT, "src", "assets", "levels")
DEFAULT_SAMPLE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sample_data")


def run(args: argparse.Namespace) -> int:
    rng = random.Random(args.seed)

    if args.mock:
        fetcher = MockFetcher(sample_dir=args.sample_dir, cache_dir=args.cache_dir)
        codes = args.codes.split(",") if args.codes else fetcher.list_codes()
    else:
        fetcher = BaostockFetcher(cache_dir=args.cache_dir)
        if not args.codes:
            print("真实模式需 --codes 指定股票代码（逗号分隔）。", file=sys.stderr)
            return 2
        codes = args.codes.split(",")

    packs_with_diff = []
    for i, code in enumerate(codes):
        code = code.strip()
        if not code:
            continue
        try:
            series = fetcher.fetch(code, args.start, args.end)
        except Exception as exc:  # noqa: BLE001 — 单只失败不阻塞整体（断点续采友好）
            print(f"[skip] 采集失败 {code}: {exc}", file=sys.stderr)
            continue

        # 后复权（样本无复权因子 -> 恒等）
        adjusted = adjuster.back_adjust(series, factors=None)

        if len(adjusted.bars) < 30:
            print(f"[skip] {code} 行情不足 30 日（{len(adjusted.bars)}）", file=sys.stderr)
            continue

        level_id = f"level_b{str(i + 1).zfill(4)}"
        try:
            pack, difficulty = level_builder.build_level(adjusted, level_id, rng=rng)
        except Exception as exc:  # noqa: BLE001
            print(f"[skip] 切关卡失败 {code}: {exc}", file=sys.stderr)
            continue
        packs_with_diff.append((pack, difficulty))
        print(f"[ok] {level_id}  days={pack.totalDays}  tags={pack.reveal.outcomeTags}  diff={difficulty}")

    if not packs_with_diff:
        print("没有产出任何关卡。", file=sys.stderr)
        return 1

    entries = exporter.export_levels(packs_with_diff, args.levels_dir, args.out_subdir)
    out_dir = os.path.join(args.levels_dir, args.out_subdir)
    print(f"导出 {len(entries)} 个关卡 -> {out_dir}")

    if not args.mock and isinstance(fetcher, BaostockFetcher):
        fetcher.close()
    return 0


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="pipeline", description="股票关卡数据管线")
    p.add_argument("--mock", action="store_true", help="离线模式：用 sample_data 小样本")
    p.add_argument("--sample-dir", default=DEFAULT_SAMPLE_DIR, help="样本目录（mock）")
    p.add_argument("--codes", default="", help="股票代码列表，逗号分隔（真实模式必填）")
    p.add_argument("--start", default="2015-01-01", help="采集起始日期 YYYY-MM-DD")
    p.add_argument("--end", default="2023-12-31", help="采集结束日期 YYYY-MM-DD")
    p.add_argument("--levels-dir", default=DEFAULT_LEVELS_DIR, help="关卡输出根目录")
    p.add_argument("--out-subdir", default=exporter.DEFAULT_OUTPUT_SUBDIR, help="输出子目录（避免覆盖种子）")
    p.add_argument("--cache-dir", default=None, help="断点续采缓存目录")
    p.add_argument("--seed", type=int, default=20260529, help="可复现随机种子")
    return p


def main(argv: List[str] = None) -> int:
    args = build_arg_parser().parse_args(argv)
    return run(args)


if __name__ == "__main__":
    raise SystemExit(main())
