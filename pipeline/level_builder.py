"""level_builder —— 切 30~60 日窗口、revealDays=10、写真实 halt/st/delist 事件、打 difficulty/outcomeTags。

输入：单只股票【复权后】的 RawBar 序列 + SecurityMeta（含身份，用于换手率与生成 story，但 story 中
身份信息属设计允许——contract 说 reveal.story 可含真实代号，只是不在游戏过程暴露）。

流程：
1. 选窗口：在序列中选一段长度 ∈ [30,60] 的连续交易日。可指定 start_index，否则用可复现 RNG 选。
2. 检测事件（相对窗口归零）：
   - halt   : 连续 tradable=False 段 -> startDay=段首, endDay=段末, resumeDay=段末+1（若在窗口内）。
              超长停牌（停牌跨过窗口末尾、本局无复牌）则省略 resumeDay。
   - st     : is_st=True 段 -> startDay=首个 ST 日, endDay=窗口末（ST 一般持续到结束）。
   - delist : is_delisted=True 段 -> startDay=首个退市日, endDay=窗口末。
3. 脱敏：交给 anonymizer.to_day_bars 得到 DayBar（含 priceLimit）。
4. 打标签：根据区间涨跌幅 + 事件类型推断 outcomeTags 与 difficulty。
5. 组装 LevelPack（reveal.story 由模板生成）。
"""

from __future__ import annotations

import random
from typing import List, Optional, Sequence, Tuple

from . import anonymizer, indicators
from .models import DayBar, LevelPack, MarketEvent, RawBar, Reveal, SecuritySeries

REVEAL_DAYS = 10
START_CASH = 100000
ST_PRICE_LIMIT = 0.05


# ----------------------------------------------------------------- 事件检测


def detect_halt_events(bars: Sequence[RawBar]) -> List[MarketEvent]:
    """检测停牌段（连续 tradable=False）。相对窗口日序（bars 已是窗口切片，下标即 day）。"""
    events: List[MarketEvent] = []
    n = len(bars)
    i = 0
    while i < n:
        if not bars[i].tradable:
            start = i
            while i < n and not bars[i].tradable:
                i += 1
            end = i - 1  # 停牌段最后一日
            ev = MarketEvent(type="halt", startDay=start, endDay=end)
            # 复牌首日 = end+1，落在窗口内才记 resumeDay；否则超长停牌（本局永不复牌）。
            if end + 1 < n:
                ev.resumeDay = end + 1
            events.append(ev)
        else:
            i += 1
    return events


def detect_st_event(bars: Sequence[RawBar]) -> Optional[MarketEvent]:
    start = next((i for i, b in enumerate(bars) if b.is_st), None)
    if start is None:
        return None
    return MarketEvent(type="st", startDay=start, endDay=len(bars) - 1)


def detect_delist_event(bars: Sequence[RawBar]) -> Optional[MarketEvent]:
    start = next((i for i, b in enumerate(bars) if b.is_delisted), None)
    if start is None:
        return None
    return MarketEvent(type="delist", startDay=start, endDay=len(bars) - 1)


def detect_events(bars: Sequence[RawBar]) -> List[MarketEvent]:
    events = detect_halt_events(bars)
    st = detect_st_event(bars)
    if st:
        events.append(st)
    delist = detect_delist_event(bars)
    if delist:
        events.append(delist)
    return events


# ----------------------------------------------------------------- 标签 / 难度


def classify(bars: Sequence[RawBar], events: Sequence[MarketEvent]) -> Tuple[List[str], str]:
    """根据区间涨跌幅 + 事件推断 outcomeTags 与 difficulty。

    标签集合对齐前端：surge / crash / flat / normal-halt / long-halt / st / delisted。
    优先级：退市 > 超长停牌 > ST > 普通停牌 > 涨跌幅(surge/crash/flat)。
    """
    closes = [b.close for b in bars]
    change = indicators.range_change_pct(closes) or 0.0

    has_delist = any(e.type == "delist" for e in events)
    halts = [e for e in events if e.type == "halt"]
    has_st = any(e.type == "st" for e in events)
    long_halt = any(e.type == "halt" and e.resumeDay is None for e in halts)
    normal_halt = any(e.type == "halt" and e.resumeDay is not None for e in halts)

    tags: List[str] = []
    difficulty = "normal"

    if has_delist:
        tags.append("delisted")
        difficulty = "hard"
    if long_halt:
        tags.append("long-halt")
        difficulty = "hard"
    elif normal_halt:
        tags.append("normal-halt")
        difficulty = "normal"
    if has_st:
        tags.append("st")
        difficulty = "hard"

    # 行情形态（始终给一个走势标签，除非已是退市/长停主导）
    if not has_delist:
        if change >= 20:
            tags.append("surge")
            if not (long_halt or has_st):
                difficulty = "easy"
        elif change <= -20:
            tags.append("crash")
        elif -8 <= change <= 8 and not tags:
            tags.append("flat")
            difficulty = "easy"

    if not tags:
        # 兜底：温和涨跌
        tags.append("surge" if change > 0 else "crash")

    return tags, difficulty


# ----------------------------------------------------------------- 窗口选择


def pick_window(
    bars: Sequence[RawBar],
    rng: random.Random,
    min_days: int = 30,
    max_days: int = 60,
    start_index: Optional[int] = None,
    length: Optional[int] = None,
) -> Tuple[int, int]:
    """返回 (start, length)。保证窗口落在序列内且长度 ∈ [min_days,max_days]。"""
    n = len(bars)
    if n < min_days:
        raise ValueError(f"序列长度 {n} 不足以切出 {min_days} 日窗口")
    L = length if length is not None else rng.randint(min_days, min(max_days, n))
    L = max(min_days, min(L, max_days, n))
    if start_index is not None:
        start = max(0, min(start_index, n - L))
    else:
        start = rng.randint(0, n - L)
    return start, L


# ----------------------------------------------------------------- 组装


def _market_label(code: str) -> Optional[str]:
    """由 baostock 代码前缀推断市场标签（仅用于真实数据复盘揭盘）。"""
    c = (code or "").lower()
    if c.startswith("sh."):
        return "A股 · 沪市"
    if c.startswith("sz."):
        return "A股 · 深市"
    if c.startswith("bj."):
        return "A股 · 北交所"
    return "A股"


def build_level(
    series: SecuritySeries,
    level_id: str,
    *,
    rng: Optional[random.Random] = None,
    start_index: Optional[int] = None,
    length: Optional[int] = None,
    story: Optional[str] = None,
    expose_identity: bool = False,
) -> Tuple[LevelPack, str]:
    """从一只股票的（复权后）序列切一关，返回 (LevelPack, difficulty)。

    expose_identity=True 时（仅真实数据），把真实名称/真实时间区间/市场写入 reveal，
    供【结算复盘】揭盘——游戏过程仍只读脱敏 DayBar，绝不暴露身份。mock/合成关卡保持全匿名。
    """
    rng = rng or random.Random(0)
    start, L = pick_window(series.bars, rng, start_index=start_index, length=length)
    window: List[RawBar] = list(series.bars[start : start + L])

    events = detect_events(window)
    tags, difficulty = classify(window, events)

    day_bars: List[DayBar] = anonymizer.to_day_bars(
        window, series.meta, st_price_limit=ST_PRICE_LIMIT
    )

    if story is None:
        story = build_story(tags, window, events, series.meta)

    reveal = Reveal(outcomeTags=tags, story=story)
    if expose_identity:
        reveal.realName = series.meta.name or None
        if window and window[0].date and window[-1].date:
            reveal.period = f"{window[0].date} ~ {window[-1].date}"
        reveal.market = _market_label(series.meta.code)

    pack = LevelPack(
        levelId=level_id,
        totalDays=L,
        revealDays=REVEAL_DAYS,
        startCash=START_CASH,
        days=day_bars,
        events=events,
        reveal=reveal,
    )
    return pack, difficulty


def build_story(tags, bars, events, meta) -> str:
    """生成结局揭盘文案。contract 允许 story 含真实代号（仅复盘揭示，游戏过程不暴露）。"""
    closes = [b.close for b in bars]
    change = indicators.range_change_pct(closes) or 0.0
    parts: List[str] = []

    if "delisted" in tags:
        d = next((e for e in events if e.type == "delist"), None)
        sd = d.startDay if d else "?"
        parts.append(f"复盘：该股于第 {sd} 日触发退市，持仓价值归零、永远无法翻身。")
    if "long-halt" in tags:
        h = next((e for e in events if e.type == "halt" and e.resumeDay is None), None)
        sd = h.startDay if h else "?"
        parts.append(
            f"复盘：该股于第 {sd} 日起进入超长停牌，停牌跨度超过本局剩余交易日——"
            f"若不点'跳到复牌首日'将永远等不到复牌。"
        )
    if "normal-halt" in tags:
        h = next((e for e in events if e.type == "halt" and e.resumeDay is not None), None)
        if h:
            parts.append(
                f"复盘：该股于第 {h.startDay} 日起停牌，第 {h.resumeDay} 日复牌（可能跳空）。"
                f"停牌期间无法交易、价格冻结。"
            )
    if "st" in tags:
        s = next((e for e in events if e.type == "st"), None)
        sd = s.startDay if s else "?"
        parts.append(
            f"复盘：该股于第 {sd} 日被实施 ST，此后每日涨跌幅收窄至 ±5%，流动性恶化。"
            f"异常的窄幅波动其实早有暗示。"
        )
    if "surge" in tags and not parts:
        parts.append(f"复盘：区间累计上涨约 {change:.1f}%，景气上行、资金抱团的成长行情。")
    if "crash" in tags and not parts:
        parts.append(f"复盘：区间累计下跌约 {change:.1f}%，杀估值式快速回撤，落袋为安才是赢家。")
    if "flat" in tags and not parts:
        parts.append("复盘：低波动横盘整理，缺乏催化、量能温吞。")

    if not parts:
        parts.append(f"复盘：区间涨跌幅约 {change:.1f}%。")
    return " ".join(parts)
