"""全市场量产管线（子项目 B 正式版）。

从 baostock 枚举 A 股全市场代码 → 断点续采批量抓取 → 后复权 → 脱敏切关 →
写入真实揭盘身份（名称/市场/时间段，仅复盘可见）→ 输出到 src/assets/levels/market/。

特点：
- 断点续采：已生成的关卡（market/level_m*.json 存在）直接跳过；缓存按代码持久化，可多次续跑。
- 匿名：关卡 levelId 用稳定序号（按代码排序后的位次），绝不含真实代码；
  真实身份只进 reveal（名称/市场/时间段），供结算复盘，游戏过程不暴露。
- 增量索引：每 N 只刷新一次 market/index.json，部分完成也可用。

用法：
  python3 -m pipeline.build_market --cache-dir /tmp/bs_market --limit 0   # 全量(limit=0 不限)
  python3 -m pipeline.build_market --limit 30                            # 小样本验证
"""

from __future__ import annotations

import argparse
import os
import random
import sys
import time
from typing import List, Optional, Tuple

from . import adjuster, exporter, level_builder
from .fetcher import BaostockFetcher
from .models import LevelIndexEntry, LevelPack

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_LEVELS_DIR = os.path.join(REPO_ROOT, "src", "assets", "levels")
SEED = 20260529

A_SHARE_PREFIXES = ("sh.6", "sz.0", "sz.3", "bj.")


def discover_codes(bs, day: str) -> List[Tuple[str, str]]:
    """枚举某交易日全市场，过滤出 A 股个股，返回 [(code, name)] 按 code 排序。"""
    rs = bs.query_all_stock(day=day)
    rows = []
    while rs.error_code == "0" and rs.next():
        rows.append(rs.get_row_data())  # [code, tradeStatus, code_name]
    a = [
        (r[0], r[2])
        for r in rows
        if any(r[0].startswith(p) for p in A_SHARE_PREFIXES)
    ]
    a.sort(key=lambda x: x[0])
    return a


def run(args: argparse.Namespace) -> int:
    out_subdir = args.out_subdir
    out_dir = os.path.join(args.levels_dir, out_subdir)
    os.makedirs(out_dir, exist_ok=True)

    fetcher = BaostockFetcher(cache_dir=args.cache_dir, min_interval=args.min_interval)
    bs = fetcher._ensure_login()

    codes = discover_codes(bs, args.day)
    if args.limit and args.limit > 0:
        codes = codes[: args.limit]
    total = len(codes)
    print(f"[market] 全市场 A 股个股: {total} 只（输出 -> {out_dir}）", flush=True)

    entries: List[LevelIndexEntry] = []
    ok = skip = fail = 0
    t0 = time.time()

    for seq, (code, _name) in enumerate(codes):
        level_id = f"level_m{seq:05d}"  # 稳定序号，不含真实代码
        file_ref = os.path.join(out_subdir, f"{level_id}.json")
        full_path = os.path.join(args.levels_dir, file_ref)

        # 断点续采：已生成则跳过（但仍要补进索引）。
        if os.path.exists(full_path):
            # 已存在的关卡，读回 tags/totalDays 以补索引（轻量）。
            try:
                import json

                d = json.load(open(full_path, encoding="utf-8"))
                entries.append(
                    LevelIndexEntry(
                        levelId=d["levelId"],
                        difficulty=_difficulty_from_tags(d["reveal"]["outcomeTags"]),
                        outcomeTags=d["reveal"]["outcomeTags"],
                        totalDays=d["totalDays"],
                        file=file_ref,
                    )
                )
                skip += 1
                continue
            except Exception:
                pass  # 损坏则重建

        try:
            series = fetcher.fetch(code, args.start, args.end)
        except Exception as exc:  # noqa: BLE001
            print(f"[skip] 采集失败 {code}: {exc}", file=sys.stderr)
            fail += 1
            continue

        adjusted = adjuster.back_adjust(series, factors=None)
        if len(adjusted.bars) < 30:
            fail += 1
            continue

        rng = random.Random(SEED + seq)  # 每关可复现
        try:
            pack, difficulty = level_builder.build_level(
                adjusted, level_id, rng=rng, expose_identity=True
            )
        except Exception as exc:  # noqa: BLE001
            print(f"[skip] 切关失败 {code}: {exc}", file=sys.stderr)
            fail += 1
            continue

        exporter.write_level(pack, args.levels_dir, out_subdir)
        entries.append(
            LevelIndexEntry(
                levelId=pack.levelId,
                difficulty=difficulty,
                outcomeTags=pack.reveal.outcomeTags,
                totalDays=pack.totalDays,
                file=file_ref,
            )
        )
        ok += 1

        if (ok + skip) % args.flush_every == 0:
            exporter.write_index(entries, args.levels_dir, out_subdir)
            rate = (ok) / max(time.time() - t0, 1e-6)
            print(
                f"[market] 进度 {seq + 1}/{total}  新建 {ok} 跳过 {skip} 失败 {fail}  "
                f"~{rate:.1f} 关/s",
                flush=True,
            )

    exporter.write_index(entries, args.levels_dir, out_subdir)
    fetcher.close()
    print(
        f"[market] 完成：索引 {len(entries)} 关（新建 {ok} / 跳过 {skip} / 失败 {fail}），"
        f"耗时 {time.time() - t0:.0f}s",
        flush=True,
    )
    return 0


def _difficulty_from_tags(tags) -> str:
    t = set(tags)
    if "delisted" in t or "long-halt" in t:
        return "hard"
    if "crash" in t or "st" in t or "normal-halt" in t:
        return "normal"
    return "easy"


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="pipeline.build_market", description="全市场 A 股量产管线")
    p.add_argument("--day", default="2023-12-29", help="枚举全市场代码所用的交易日")
    p.add_argument("--start", default="2015-01-01")
    p.add_argument("--end", default="2023-12-31")
    p.add_argument("--limit", type=int, default=0, help="只取前 N 只（0=全量）")
    p.add_argument("--levels-dir", default=DEFAULT_LEVELS_DIR)
    p.add_argument("--out-subdir", default="market")
    p.add_argument("--cache-dir", default="/tmp/bs_market_cache")
    p.add_argument("--min-interval", type=float, default=0.15, help="限流：两次请求最小间隔秒")
    p.add_argument("--flush-every", type=int, default=50, help="每 N 关刷新一次索引并打印进度")
    return p


if __name__ == "__main__":
    raise SystemExit(run(build_arg_parser().parse_args()))
