/**
 * 游戏引擎入口（纯函数状态机，零框架依赖，可独立单测）。
 *
 * 设计要点：
 * - currentDay 表示"当前已揭示到的相对日序"，从 revealDays - 1（=9）开始。
 *   玩家在 currentDay 这一天做决策：buy/sell 以当日收盘价（停牌复牌跳空时以复牌首日开盘价）成交。
 * - advance 推进到下一交易日，并刷新 status / lastEvent。
 * - 所有状态更新均为不可变（返回新对象），输入 state 不被修改。
 * - 事件优先级：delist > halt > st。退市一旦触发立即结束本局，持仓市值归零。
 */

import type { DayBar, LevelPack, MarketEvent } from '../types/contract'
import type {
  Action,
  GameState,
  Grade,
  HistoryEntry,
  SettleResult,
} from './types'

export * from './types'

/** 默认手续费率（小额，可配置；设 0 关闭） */
export const DEFAULT_FEE_RATE = 0.0005

/** ST 默认涨跌幅限制（当某日处于 ST 事件中但行情未显式标注 priceLimit 时的兜底）。 */
export const DEFAULT_ST_PRICE_LIMIT = 0.05

/**
 * 触发"跳到复牌首日"按钮的停牌跨度阈值（交易日）。
 * 停牌从 startDay 到复牌日（或本局结束）若超过该跨度，即视为"超长停牌"，
 * 提供一键跳转，避免玩家反复点"下一日"空耗。
 */
export const LONG_HALT_SKIP_THRESHOLD = 5

// ---------------------------------------------------------------------------
// 内部工具
// ---------------------------------------------------------------------------

/** 取某一天的行情；越界返回 undefined。 */
function bar(level: LevelPack, day: number): DayBar | undefined {
  return level.days[day]
}

/**
 * 返回在 day 这一天"生效中"的事件（startDay <= day <= effectiveEnd）。
 * 优先级：delist > halt > st。
 * - delist：从 startDay 起一直生效到结束（endDay 之后仍视为退市，已锁死）。
 * - halt：startDay..endDay；若 day 已到/超过 resumeDay，则不再生效。
 * - st：startDay..endDay。
 */
function activeEvent(level: LevelPack, day: number): MarketEvent | undefined {
  let halt: MarketEvent | undefined
  let st: MarketEvent | undefined
  for (const ev of level.events) {
    if (ev.type === 'delist') {
      // 退市自 startDay 起永久生效（锁死直至结束）
      if (day >= ev.startDay) return ev
    } else if (ev.type === 'halt') {
      // 停牌上界同时受 endDay 与 resumeDay 约束：day < resumeDay 才算停牌生效，
      // 与"复牌日起恢复交易"的契约一致（即便 endDay 缺省也不会无限停牌）。
      const end = Math.min(ev.endDay ?? Infinity, (ev.resumeDay ?? Infinity) - 1)
      if (day >= ev.startDay && day <= end) halt = ev
    } else if (ev.type === 'st') {
      const end = ev.endDay ?? Infinity
      if (day >= ev.startDay && day <= end) st = ev
    }
  }
  return halt ?? st
}

/** 当天是否处于退市状态。 */
function isDelisted(level: LevelPack, day: number): boolean {
  return level.events.some((ev) => ev.type === 'delist' && day >= ev.startDay)
}

/** 当天是否停牌（不可交易）。优先看行情 tradable，再看事件兜底。 */
function isHalted(level: LevelPack, day: number): boolean {
  const b = bar(level, day)
  if (b && b.tradable === false) return true
  const ev = activeEvent(level, day)
  return ev?.type === 'halt'
}

/**
 * 当天 ST 限幅（无则 undefined）。
 * 优先用行情显式标注的 priceLimit；若当日处于 ST 事件中但行情漏标，
 * 则兜底用 DEFAULT_ST_PRICE_LIMIT，避免 ST 期出现不受限的越界成交。
 */
function priceLimitOf(level: LevelPack, day: number): number | undefined {
  const b = bar(level, day)
  if (b && b.priceLimit != null) return b.priceLimit
  const ev = activeEvent(level, day)
  if (ev?.type === 'st') return DEFAULT_ST_PRICE_LIMIT
  return undefined
}

/** 取前一交易日收盘价（用于 ST 限幅基准）；无前一日则返回当日收盘。 */
function prevClose(level: LevelPack, day: number): number {
  const prev = bar(level, day - 1)
  const cur = bar(level, day)
  return prev?.close ?? cur?.close ?? 0
}

/**
 * 计算 day 这一天的成交价（受 ST 限幅约束）。
 * 基准为当日收盘价；若该日有 priceLimit，则把成交价钳制在
 * [prevClose*(1-limit), prevClose*(1+limit)] 内。
 */
function tradePrice(level: LevelPack, day: number): number {
  const b = bar(level, day)
  if (!b) return 0
  let price = b.close
  const limit = priceLimitOf(level, day)
  if (limit != null) {
    const pc = prevClose(level, day)
    const hi = pc * (1 + limit)
    const lo = pc * (1 - limit)
    if (price > hi) price = hi
    if (price < lo) price = lo
  }
  return price
}

/**
 * 计算某停牌事件是否为"超长停牌"（值得提供一键跳转）。
 * 判定（与当前日无关，故按钮在整段停牌内稳定显示/隐藏）：
 * - 无复牌日 → 本局永不复牌，超长。
 * - 复牌日落在本局之外 → 本局等不到复牌，超长。
 * - 复牌日在本局内，但停牌跨度（resumeDay - startDay）超过阈值 → 超长（可一键跳到复牌日）。
 * 否则为普通停牌，玩家逐日 advance 即可。
 */
function isLongHalt(level: LevelPack, ev: MarketEvent): boolean {
  if (ev.type !== 'halt') return false
  const resume = ev.resumeDay
  if (resume == null) return true
  if (resume > level.totalDays - 1) return true
  return resume - ev.startDay > LONG_HALT_SKIP_THRESHOLD
}

/** 找到当前生效的、且为超长停牌的事件（供 skipToResume / selector 用）。 */
function activeLongHalt(level: LevelPack, day: number): MarketEvent | undefined {
  const ev = activeEvent(level, day)
  if (ev && ev.type === 'halt' && isLongHalt(level, ev)) return ev
  return undefined
}

/** 根据 day 推导运行状态（不含 finished 的越界判断，由调用方处理）。 */
function statusAt(level: LevelPack, day: number): GameState['status'] {
  if (isDelisted(level, day)) return 'finished'
  if (isHalted(level, day)) return 'halted'
  return 'playing'
}

/** 追加一条历史记录（返回新数组）。 */
function pushHistory(
  history: HistoryEntry[],
  entry: HistoryEntry,
): HistoryEntry[] {
  return [...history, entry]
}

// ---------------------------------------------------------------------------
// 对外 API
// ---------------------------------------------------------------------------

/**
 * 根据关卡创建初始游戏状态。
 * currentDay 从 revealDays - 1 开始（默认 9）。
 */
export function createInitialState(level: LevelPack): GameState {
  // 越界防御：将起始日钳制到 [0, totalDays-1]，避免非法关卡产出不可玩状态。
  const startDay = Math.max(0, Math.min(level.revealDays - 1, level.totalDays - 1))
  const ev = activeEvent(level, startDay)
  // 初始日通常 < 事件起始日，但仍按规则推导以保稳健。
  const status = statusAt(level, startDay)
  return {
    levelId: level.levelId,
    cash: level.startCash,
    shares: 0,
    currentDay: startDay,
    totalDays: level.totalDays,
    feeRate: DEFAULT_FEE_RATE,
    status,
    lastEvent: ev,
    history: [],
  }
}

/**
 * 应用一个动作，返回新的状态（纯函数，不可变更新）。
 *
 * 规则：
 * - 已结束（finished）：任何动作都安全 no-op（返回同态状态）。
 * - buy/sell：按当日成交价（受 ST 限幅）成交、扣 feeRate 手续费；停牌日 / 退市 禁止，安全 no-op。
 * - advance：推进一日；刷新 status / lastEvent；越过末日则 finished。
 * - skipToResume：仅在"当前为超长停牌"时有效；跳到复牌首日（或本局结束）。
 */
export function applyAction(
  state: GameState,
  level: LevelPack,
  action: Action,
): GameState {
  if (state.status === 'finished') return state

  switch (action.type) {
    case 'hold':
      return state

    case 'buy':
      return doBuy(state, level, action.cashRatio)

    case 'sell':
      return doSell(state, level, action.shareRatio)

    case 'advance':
      return doAdvance(state, level)

    case 'skipToResume':
      return doSkipToResume(state, level)

    default:
      return state
  }
}

/** 买入：按 cashRatio*cash 可买的整数股。停牌 / 退市禁止。 */
function doBuy(state: GameState, level: LevelPack, cashRatio: number): GameState {
  if (isHalted(level, state.currentDay) || isDelisted(level, state.currentDay)) {
    return state // 停牌 / 退市禁止交易：安全 no-op
  }
  const ratio = clampRatio(cashRatio)
  if (ratio <= 0) return state

  const price = tradePrice(level, state.currentDay)
  if (price <= 0) return state

  const budget = state.cash * ratio
  // 含手续费的每股成本 = price * (1 + feeRate)
  const perShareCost = price * (1 + state.feeRate)
  const qty = Math.floor(budget / perShareCost)
  if (qty <= 0) return state

  const cost = qty * price
  const fee = cost * state.feeRate
  const newCash = state.cash - cost - fee
  const newShares = state.shares + qty

  return {
    ...state,
    cash: newCash,
    shares: newShares,
    history: pushHistory(state.history, {
      day: state.currentDay,
      action: 'buy',
      price,
      shares: newShares,
      cash: newCash,
    }),
  }
}

/** 卖出：按 shareRatio*shares 的整数股。停牌 / 退市禁止。 */
function doSell(
  state: GameState,
  level: LevelPack,
  shareRatio: number,
): GameState {
  if (isHalted(level, state.currentDay) || isDelisted(level, state.currentDay)) {
    return state
  }
  const ratio = clampRatio(shareRatio)
  if (ratio <= 0 || state.shares <= 0) return state

  const price = tradePrice(level, state.currentDay)
  if (price <= 0) return state

  const qty = Math.floor(state.shares * ratio)
  if (qty <= 0) return state

  const gross = qty * price
  const fee = gross * state.feeRate
  const newCash = state.cash + gross - fee
  const newShares = state.shares - qty

  return {
    ...state,
    cash: newCash,
    shares: newShares,
    history: pushHistory(state.history, {
      day: state.currentDay,
      action: 'sell',
      price,
      shares: newShares,
      cash: newCash,
    }),
  }
}

/** 推进一日：揭示下一交易日；越过末日 → finished。 */
function doAdvance(state: GameState, level: LevelPack): GameState {
  // 已在末日：再 advance 则结束本局。
  if (state.currentDay >= state.totalDays - 1) {
    return { ...state, status: 'finished' }
  }

  const nextDay = state.currentDay + 1
  const status = statusAt(level, nextDay)
  const ev = activeEvent(level, nextDay)

  return {
    ...state,
    currentDay: nextDay,
    status,
    lastEvent: ev,
  }
}

/**
 * 超长停牌跳复牌：
 * - 仅当"当前处于超长停牌"时有效，否则安全 no-op。
 * - 若复牌日存在且在本局内：直接推进到复牌首日（status 由复牌日推导）。
 * - 若无复牌日 / 复牌日超出本局（本局等不到复牌）：推进到末日并结束。
 */
function doSkipToResume(state: GameState, level: LevelPack): GameState {
  const ev = activeLongHalt(level, state.currentDay)
  if (!ev) return state // 非超长停牌：安全 no-op

  const resume = ev.resumeDay
  if (resume != null && resume <= level.totalDays - 1) {
    // 复牌日在本局内：跳到复牌首日（若复牌前已退市则停在退市日）。
    const delistDay = earliestDelistInRange(level, state.currentDay + 1, resume)
    const target = delistDay ?? resume
    return {
      ...state,
      currentDay: target,
      status: statusAt(level, target),
      lastEvent: activeEvent(level, target),
    }
  }

  // 本局等不到复牌：跳到末日并结束；若中途退市则停在退市日（市值归零的真相得以呈现）。
  const lastDay = level.totalDays - 1
  const delistDay = earliestDelistInRange(level, state.currentDay + 1, lastDay)
  const target = delistDay ?? lastDay
  return {
    ...state,
    currentDay: target,
    status: 'finished',
    lastEvent: activeEvent(level, target),
  }
}

/** 在 [from, to] 内查找最早的退市起始日；无则返回 undefined。 */
function earliestDelistInRange(
  level: LevelPack,
  from: number,
  to: number,
): number | undefined {
  let earliest: number | undefined
  for (const ev of level.events) {
    if (ev.type === 'delist' && ev.startDay >= from && ev.startDay <= to) {
      if (earliest == null || ev.startDay < earliest) earliest = ev.startDay
    }
  }
  return earliest
}

/** 把比例钳制到 [0,1]，NaN 视为 0。 */
function clampRatio(r: number): number {
  if (!Number.isFinite(r)) return 0
  if (r < 0) return 0
  if (r > 1) return 1
  return r
}

/**
 * selector：判断"跳到复牌首日"按钮当前是否应可见。
 * 条件：当前正处于超长停牌（停牌跨度超过玩家剩余交易日）且本局未结束。
 */
export function isSkipToResumeVisible(
  state: GameState,
  level: LevelPack,
): boolean {
  if (state.status === 'finished') return false
  return activeLongHalt(level, state.currentDay) != null
}

/**
 * 当前持仓市值（退市时为 0）。
 * 估值价采用"可成交价口径"（tradePrice，含 ST 限幅），与买卖成交价一致，
 * 避免 ST 限幅日"按钳制价买入、却按原始收盘估值"产生瞬时幻象收益。
 * 停牌日 close 已被数据冻结为前收，估值正确。
 */
function holdingsValue(state: GameState, level: LevelPack): number {
  if (isDelisted(level, state.currentDay)) return 0
  return state.shares * tradePrice(level, state.currentDay)
}

/**
 * 评级：依据 roi 与是否跑赢 buy&hold 基准。
 * - S：roi >= 0.5 且跑赢基准
 * - A：roi >= 0.2 且跑赢基准
 * - B：roi >= 0（不亏）且（跑赢基准 或 roi>=0.1）
 * - C：roi >= -0.2（小亏）
 * - D：其余（大亏）
 */
export function gradeOf(roi: number, buyHoldRoi: number): Grade {
  const beatBenchmark = roi >= buyHoldRoi
  if (roi >= 0.5 && beatBenchmark) return 'S'
  if (roi >= 0.2 && beatBenchmark) return 'A'
  if (roi >= 0 && (beatBenchmark || roi >= 0.1)) return 'B'
  if (roi >= -0.2) return 'C'
  return 'D'
}

/**
 * 结算：计算总资产、收益率、评级、buy&hold 基准，并返回揭盘数据。
 *
 * - finalAssets = cash + 当前持仓市值（退市为 0）。
 * - roi = finalAssets / startCash - 1。
 * - buyHoldRoi = 用初始资金在揭示末日（revealDays-1）收盘全仓买入、持有到结算日的收益率，
 *   含买入手续费；退市则市值归零。
 */
export function settle(state: GameState, level: LevelPack): SettleResult {
  const finalAssets = state.cash + holdingsValue(state, level)
  const roi = finalAssets / level.startCash - 1

  const buyHoldRoi = computeBuyHoldRoi(state, level)
  const grade = gradeOf(roi, buyHoldRoi)

  return {
    finalAssets,
    roi,
    grade,
    buyHoldRoi,
    reveal: {
      outcomeTags: level.reveal.outcomeTags,
      story: level.reveal.story,
    },
  }
}

/**
 * buy&hold 基准：在初始可决策日（revealDays-1）以收盘价用全部初始资金买入整数股，
 * 持有到结算日（state.currentDay），按结算日市值评估。退市 → 市值 0。
 */
function computeBuyHoldRoi(state: GameState, level: LevelPack): number {
  const entryDay = level.revealDays - 1
  const entry = bar(level, entryDay)
  if (!entry) return 0
  const entryPrice = entry.close
  if (entryPrice <= 0) return 0

  const perShareCost = entryPrice * (1 + state.feeRate)
  const qty = Math.floor(level.startCash / perShareCost)
  const cost = qty * entryPrice
  const fee = cost * state.feeRate
  const leftoverCash = level.startCash - cost - fee

  let exitValue: number
  if (isDelisted(level, state.currentDay)) {
    exitValue = 0
  } else {
    // 与持仓估值同口径：用可成交价（含 ST 限幅）评估退出市值。
    exitValue = qty * tradePrice(level, state.currentDay)
  }

  const finalAssets = leftoverCash + exitValue
  return finalAssets / level.startCash - 1
}
