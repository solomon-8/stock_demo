/**
 * 游戏引擎状态与动作类型定义。
 *
 * 引擎为纯函数状态机，零框架依赖，可独立单测。
 * 业务逻辑（createInitialState / applyAction / settle / selector）由后续 agent 实现，
 * 此文件仅定稿对外类型契约，下游据此实现，不得擅自更改字段名。
 */

import type { MarketEvent } from '../types/contract'

/** 游戏运行状态 */
export type GameStatus = 'playing' | 'halted' | 'finished'

/** 评级 */
export type Grade = 'S' | 'A' | 'B' | 'C' | 'D'

/** 一条历史操作记录 */
export interface HistoryEntry {
  /** 操作发生时的相对日序 */
  day: number
  /** 操作类型 */
  action: ActionType
  /** 成交价（hold / 不成交时为当日收盘价或前收，由实现定义） */
  price: number
  /** 操作后持股数 */
  shares: number
  /** 操作后现金 */
  cash: number
}

/** 游戏状态 */
export interface GameState {
  /** 当前关卡 ID */
  levelId: string
  /** 当前现金 */
  cash: number
  /** 当前持股数（MVP 用整数股） */
  shares: number
  /** 当前已揭示到的相对日序（从 revealDays-1 = 9 开始） */
  currentDay: number
  /** 本局总交易日数 */
  totalDays: number
  /** 手续费率（可配置，默认一个小比例如 0.0005，可设 0） */
  feeRate: number
  /** 运行状态 */
  status: GameStatus
  /** 当前生效的事件（如停牌中 / ST 中），用于 UI 提示与 selector 判断 */
  lastEvent?: MarketEvent
  /** 操作历史 */
  history: HistoryEntry[]
}

/** 动作类型字面量 */
export type ActionType = 'buy' | 'sell' | 'hold' | 'advance' | 'skipToResume'

/** 买入：按现金百分比 */
export interface BuyAction {
  type: 'buy'
  /** 买入金额占当前现金的比例，0~1 */
  cashRatio: number
}

/** 卖出：按持仓百分比 */
export interface SellAction {
  type: 'sell'
  /** 卖出数量占当前持仓的比例，0~1 */
  shareRatio: number
}

/** 持有：不交易 */
export interface HoldAction {
  type: 'hold'
}

/** 推进一日（揭示下一交易日） */
export interface AdvanceAction {
  type: 'advance'
}

/** 超长停牌时跳到复牌首日 */
export interface SkipToResumeAction {
  type: 'skipToResume'
}

/** 玩家动作联合类型 */
export type Action =
  | BuyAction
  | SellAction
  | HoldAction
  | AdvanceAction
  | SkipToResumeAction

/** 结算结果 */
export interface SettleResult {
  /** 结束时总资产（现金 + 持仓市值） */
  finalAssets: number
  /** 收益率（小数，如 0.23 表示 +23%） */
  roi: number
  /** 评级 */
  grade: Grade
  /** "全程持有不动" (buy & hold) 基准收益率 */
  buyHoldRoi: number
  /** 结局揭盘数据 */
  reveal: {
    outcomeTags: string[]
    story: string
    /** 真实股票名称（仅真实数据关卡有） */
    realName?: string
    /** 真实时间区间标签（仅真实数据关卡有） */
    period?: string
    /** 市场标签（仅真实数据关卡有） */
    market?: string
  }
}
