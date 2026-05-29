/**
 * 游戏状态 hook（集成层）。
 *
 * 职责：把 src/data（关卡加载器）+ src/engine（纯函数状态机）粘合成可供 UI 消费的 React 状态：
 * - 用 loadRandomLevel 随机抽一只「匿名」股票的一段历史作为关卡。
 * - 用 createInitialState / applyAction / settle 维护并推进 GameState（不可变）。
 * - 暴露 dispatch(action) 与一组派生数据（已揭示的 days、当日价、涨跌幅、剩余天数、
 *   跳复牌按钮可见性、是否结束、结算结果）供页面直接渲染。
 *
 * 设计原则：
 * - 本 hook 不含任何渲染逻辑，也不直接读取 DOM；纯粹是「数据加载 + 引擎驱动 + 派生」。
 * - 引擎是纯函数：dispatch 只是 setState((s) => applyAction(s, level, action))。
 *   hold / 非法动作返回同一引用，React 会跳过重渲染。
 * - 脱敏：派生数据只取行情字段（DayBar），不向 UI 暴露 events / reveal（结算时才通过
 *   settle + level.events 揭盘）。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { DayBar, LevelPack } from '../types/contract'
import {
  applyAction,
  createInitialState,
  isSkipToResumeVisible,
  settle,
  type Action,
  type GameState,
  type SettleResult,
} from '../engine'
import { loadRandomLevel } from '../data'

/**
 * 加载阶段。
 * - home：起始页（初始态，尚未抽关，等待玩家点「开始挑战」）。
 * - loading / ready / error：加载关卡的生命周期。
 */
export type LoadPhase = 'home' | 'loading' | 'ready' | 'error'

/** 派生视图数据（供页面/组件直接消费，全部已脱敏）。 */
export interface GameView {
  /** 已揭示的逐日行情（day 0 .. currentDay，含当日），传给 Chart。 */
  revealedDays: DayBar[]
  /** 当日行情（currentDay 对应的 DayBar）。 */
  today?: DayBar
  /** 当日成交参考价（收盘价）。 */
  price: number
  /** 当日涨跌幅（相对前一交易日收盘，小数）。首日为 undefined。 */
  changePct?: number
  /** 当日是否可交易（停牌为 false）。 */
  tradable: boolean
  /** 剩余交易日数（含当日）。 */
  daysLeft: number
  /** 本局总交易日数。 */
  totalDays: number
  /** 是否显示「跳到复牌首日」按钮（超长停牌时）。 */
  skipToResumeVisible: boolean
  /** 本局是否已结束（退市 / 推进过末日）。 */
  finished: boolean
}

/** hook 对外返回值。 */
export interface UseGameResult {
  /** 加载阶段。 */
  phase: LoadPhase
  /** 加载失败时的错误信息。 */
  error?: string
  /** 当前关卡包（已脱敏；UI 仅在结算时用其 events 揭盘）。 */
  level?: LevelPack
  /** 当前游戏状态（引擎维护的不可变状态）。 */
  state?: GameState
  /** 派生视图数据。 */
  view?: GameView
  /** 结算结果（仅在 finished 时有值）。 */
  result?: SettleResult
  /** 派发一个引擎动作。 */
  dispatch: (action: Action) => void
  /** 从起始页开始游戏（抽关进 loading）；仅在 phase==='home' 时有意义。 */
  start: () => void
  /** 再来一局（重新随机抽关并重置状态）。 */
  restart: () => void
}

/** 取某日的 close 价（越界为 0）。 */
function closeAt(level: LevelPack, day: number): number {
  return level.days[day]?.close ?? 0
}

/**
 * 游戏状态 hook。
 *
 * @param seedExcludeLevelIds 可选：重开时尽量避开这些关卡 ID（防止连续抽到同一关）。
 */
export function useGame(): UseGameResult {
  // 初始态为起始页：不立即抽关，等玩家点「开始挑战」(start) 才进 loading。
  const [phase, setPhase] = useState<LoadPhase>('home')
  const [error, setError] = useState<string | undefined>(undefined)
  const [level, setLevel] = useState<LevelPack | undefined>(undefined)
  const [state, setState] = useState<GameState | undefined>(undefined)
  // 已玩过的关卡 ID，重开时尽量避开（候选耗尽时加载器自会回退）。
  const [played, setPlayed] = useState<string[]>([])
  // 自增触发器：round 0 = 起始页(不加载)；start/restart 各 +1 触发(重)加载。
  const [round, setRound] = useState(0)

  // 加载关卡 + 初始化引擎状态。
  useEffect(() => {
    // 首帧 round===0 处于起始页(home)，不自动抽关；待 start() 把 round 推到 1 才加载。
    if (round === 0) return
    let cancelled = false
    setPhase('loading')
    setError(undefined)
    loadRandomLevel({ excludeLevelIds: played })
      .then(({ level: lv }) => {
        if (cancelled) return
        setLevel(lv)
        setState(createInitialState(lv))
        setPhase('ready')
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
        setPhase('error')
      })
    return () => {
      cancelled = true
    }
    // played 仅在 restart 时与 round 一起更新；用 round 作为唯一触发依赖避免重复加载。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round])

  const dispatch = useCallback(
    (action: Action) => {
      if (!level) return
      setState((s) => (s ? applyAction(s, level, action) : s))
    },
    [level],
  )

  const start = useCallback(() => {
    // 起始页点「开始挑战」：从 home 推进到首次加载。
    setRound((r) => r + 1)
  }, [])

  const restart = useCallback(() => {
    setPlayed((prev) =>
      level && !prev.includes(level.levelId)
        ? [...prev, level.levelId]
        : prev,
    )
    setRound((r) => r + 1)
  }, [level])

  // 派生视图数据（脱敏：只读 DayBar 行情字段）。
  const view = useMemo<GameView | undefined>(() => {
    if (!level || !state) return undefined
    const day = state.currentDay
    const today = level.days[day]
    const price = closeAt(level, day)
    const prevCloseVal = day > 0 ? closeAt(level, day - 1) : undefined
    const changePct =
      prevCloseVal && prevCloseVal > 0 ? price / prevCloseVal - 1 : undefined
    const finished = state.status === 'finished'
    return {
      revealedDays: level.days.slice(0, day + 1),
      today,
      price,
      changePct,
      tradable: today?.tradable !== false,
      // 剩余天数（含当日）：末日时为 1。
      daysLeft: Math.max(level.totalDays - day, 0),
      totalDays: level.totalDays,
      skipToResumeVisible: isSkipToResumeVisible(state, level),
      finished,
    }
  }, [level, state])

  // 结算结果：仅在 finished 时计算。
  const result = useMemo<SettleResult | undefined>(() => {
    if (!level || !state || state.status !== 'finished') return undefined
    return settle(state, level)
  }, [level, state])

  return {
    phase,
    error,
    level,
    state,
    view,
    result,
    dispatch,
    start,
    restart,
  }
}

export default useGame
