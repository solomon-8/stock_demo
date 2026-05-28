/**
 * 数据契约（关卡包） —— 子项目 A（游戏客户端）与 B（数据管线）之间的唯一接口。
 *
 * 字段名以本文件为准，下游 (engine / data loader / components / pipeline / tools) 必须严格遵守。
 * 脱敏要求：关卡包中不得包含任何可还原股票真实身份的字段（名称、代码、绝对日期）。
 */

/**
 * 单个交易日的行情与预计算指标。
 *
 * 约束：
 * - low <= open <= high 且 low <= close <= high
 * - 停牌日 tradable=false，价格沿用前一交易日（open=high=low=close=前收），volume 通常为 0
 */
export interface DayBar {
  /** 相对日序，从 0 起（脱敏后的时间轴，不暴露真实日期） */
  day: number
  /** 开盘价 */
  open: number
  /** 最高价 */
  high: number
  /** 最低价 */
  low: number
  /** 收盘价 */
  close: number
  /** 成交量 */
  volume: number
  /** 换手率（百分比，如 3.2 表示 3.2%） */
  turnover?: number
  /** 量比 */
  volumeRatio?: number
  /** 5 日均线 */
  ma5?: number
  /** 10 日均线 */
  ma10?: number
  /** 20 日均线 */
  ma20?: number
  /** MACD 柱（= 2 * (dif - dea)） */
  macd?: number
  /** DIF（快慢均线差） */
  dif?: number
  /** DEA（DIF 的 9 日 EMA） */
  dea?: number
  /** RSI（相对强弱指标，0~100） */
  rsi?: number
  /** 当日是否可交易；停牌为 false（价格冻结、不能买卖） */
  tradable: boolean
  /**
   * 当日涨跌幅限制，相对前收。如 0.05 表示 ±5%（ST 收窄时使用）。
   * 不限制时填 null / undefined。
   */
  priceLimit?: number | null
}

/** 市场事件类型 */
export type MarketEventType = 'halt' | 'st' | 'delist'

/**
 * 市场事件（来自真实数据，结局复盘时才揭示给玩家）。
 */
export interface MarketEvent {
  /** 事件类型：停牌 / ST / 退市 */
  type: MarketEventType
  /** 事件起始相对日序 */
  startDay: number
  /** 事件结束相对日序（可选；如 ST 段、停牌段的最后一日） */
  endDay?: number
  /** 复牌首日相对日序（halt 专用：停牌结束后第一个可交易日） */
  resumeDay?: number
}

/**
 * 单关卡数据包（level_<id>.json）。
 */
export interface LevelPack {
  /** 关卡唯一 ID */
  levelId: string
  /** 本局总交易日数（30~60，含初始展示的 revealDays 天） */
  totalDays: number
  /** 初始完整展示的交易日数（固定 = 10） */
  revealDays: number
  /** 初始虚拟资金（固定 = 100000） */
  startCash: number
  /** 逐日行情数组，长度严格等于 totalDays */
  days: DayBar[]
  /** 市场事件列表（用于结局揭盘） */
  events: MarketEvent[]
  /** 结局揭盘数据 */
  reveal: {
    /** 结局类型标签，如 ['surge'] / ['delisted'] / ['st','crash'] */
    outcomeTags: string[]
    /** 结局揭盘文案（可含真实代号，但不在游戏过程中暴露） */
    story: string
  }
}

/** 关卡难度 */
export type LevelDifficulty = 'easy' | 'normal' | 'hard'

/**
 * 关卡索引项（index.json 中的一条）。
 */
export interface LevelIndexEntry {
  /** 关卡唯一 ID（与 LevelPack.levelId 对应） */
  levelId: string
  /** 难度 */
  difficulty: LevelDifficulty
  /** 结局类型标签 */
  outcomeTags: string[]
  /** 本局总交易日数 */
  totalDays: number
  /** 关卡文件路径（相对 levels 目录，如 'level_0001.json'） */
  file: string
}

/**
 * 关卡索引（index.json）。
 */
export interface LevelIndex {
  /** 所有关卡的索引列表 */
  levels: LevelIndexEntry[]
}
