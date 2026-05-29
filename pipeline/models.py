"""管线内部数据模型。

分两层：
1. 采集层（含身份信息）：RawBar / SecurityMeta —— 仅在内存/缓存阶段使用，绝不进入最终关卡包。
2. 契约层（脱敏后）：DayBar / MarketEvent / LevelPack / LevelIndexEntry —— 字段名/语义严格对齐
   src/types/contract.ts，由 exporter 直接序列化为关卡包 JSON。

注意：契约层 dataclass 序列化时必须丢弃所有 `None` 字段（对应 TS 的 optional），
exporter 负责该裁剪，使产出与前端契约一致（如 priceLimit 不限制时省略或为 null）。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Literal, Optional

# ------------------------------------------------------------------ 采集层（含身份）

MarketEventType = Literal["halt", "st", "delist"]


@dataclass
class RawBar:
    """单只股票单日原始行情（采集层，含真实日期；脱敏前的内部表示）。

    date 为真实交易日字符串（YYYY-MM-DD），仅内部使用，绝不进入关卡包。
    价格为【未复权】原始价；复权由 adjuster 处理后写回同结构。
    """

    date: str
    open: float
    high: float
    low: float
    close: float
    volume: float  # 成交量（股）
    amount: Optional[float] = None  # 成交额（元），用于量比/换手校验，可选
    turnover: Optional[float] = None  # 当日换手率%（数据源直供，如 baostock turn 字段），可选
    tradable: bool = True  # 当日是否可交易（停牌为 False）
    is_st: bool = False  # 当日是否处于 ST 状态
    is_delisted: bool = False  # 当日是否已退市/退市整理期


@dataclass
class SecurityMeta:
    """证券元信息（采集层，含身份）。绝不进入关卡包。"""

    code: str  # 股票代码，如 "sh.600000"
    name: str  # 股票名称
    float_shares: Optional[float] = None  # 流通股本（股），用于换手率口径
    total_shares: Optional[float] = None  # 总股本（股）


@dataclass
class SecuritySeries:
    """单只股票的完整采集结果（采集层，含身份）。"""

    meta: SecurityMeta
    bars: List[RawBar] = field(default_factory=list)


# ------------------------------------------------------------------ 契约层（脱敏后）


@dataclass
class DayBar:
    """对齐 src/types/contract.ts 的 DayBar。

    脱敏后字段：相对日序 day，不含任何真实日期/代码。
    optional 字段为 None 时由 exporter 在序列化阶段丢弃。
    """

    day: int
    open: float
    high: float
    low: float
    close: float
    volume: float
    tradable: bool
    turnover: Optional[float] = None
    volumeRatio: Optional[float] = None
    ma5: Optional[float] = None
    ma10: Optional[float] = None
    ma20: Optional[float] = None
    macd: Optional[float] = None
    dif: Optional[float] = None
    dea: Optional[float] = None
    rsi: Optional[float] = None
    priceLimit: Optional[float] = None


@dataclass
class MarketEvent:
    """对齐 src/types/contract.ts 的 MarketEvent。"""

    type: MarketEventType
    startDay: int
    endDay: Optional[int] = None
    resumeDay: Optional[int] = None


@dataclass
class Reveal:
    outcomeTags: List[str]
    story: str
    # 真实身份字段：仅真实数据关卡有，仅供结算复盘揭盘，绝不在游戏过程暴露。
    realName: Optional[str] = None
    period: Optional[str] = None
    market: Optional[str] = None


@dataclass
class LevelPack:
    """对齐 src/types/contract.ts 的 LevelPack。"""

    levelId: str
    totalDays: int
    revealDays: int
    startCash: int
    days: List[DayBar]
    events: List[MarketEvent]
    reveal: Reveal


@dataclass
class LevelIndexEntry:
    """对齐 src/types/contract.ts 的 LevelIndexEntry。"""

    levelId: str
    difficulty: Literal["easy", "normal", "hard"]
    outcomeTags: List[str]
    totalDays: int
    file: str
