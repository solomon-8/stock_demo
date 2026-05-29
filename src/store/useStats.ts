/**
 * 本地战绩持久化（集成层，不进引擎）。
 *
 * 职责：用 localStorage 读写玩家累计战绩 { gamesPlayed, bestRoi, wins }，
 * 供起始页「最佳记录区」展示，结算时由页面调用 record() 记一局。
 *
 * 设计原则：
 * - 纯展示层 / 集成层副作用，绝不触碰 engine / loader / contract 语义。
 * - H5 环境为主；SSR / 无 localStorage / 解析异常时全程 try/catch，降级为内存态，
 *   保证不崩页、不影响单测（vitest 不渲染本 hook）。
 * - roi 以小数存储（与 SettleResult.roi 一致，0.23 = +23%）。
 */
import { useCallback, useState } from 'react'

/** 持久化的累计战绩。 */
export interface Stats {
  /** 累计玩过的局数 */
  gamesPlayed: number
  /** 历史最佳收益率（小数）；从未玩过为 undefined */
  bestRoi?: number
  /** 盈利（roi > 0）的局数 */
  wins: number
}

/** localStorage 键名。 */
export const STATS_KEY = 'anonymousgod.stats'

/** 空战绩（首玩 / 降级态）。 */
const EMPTY_STATS: Stats = { gamesPlayed: 0, bestRoi: undefined, wins: 0 }

/** 安全获取 localStorage（SSR / 受限环境返回 undefined）。 */
function safeStorage(): Storage | undefined {
  try {
    if (typeof localStorage !== 'undefined') return localStorage
  } catch {
    // 访问 localStorage 本身可能抛（隐私模式 / iframe 限制）
  }
  return undefined
}

/** 读取并校验持久化战绩；任何异常都降级为空战绩。 */
function readStats(): Stats {
  const store = safeStorage()
  if (!store) return EMPTY_STATS
  try {
    const raw = store.getItem(STATS_KEY)
    if (!raw) return EMPTY_STATS
    const parsed = JSON.parse(raw) as Partial<Stats>
    const gamesPlayed =
      typeof parsed.gamesPlayed === 'number' && parsed.gamesPlayed >= 0
        ? Math.floor(parsed.gamesPlayed)
        : 0
    const wins =
      typeof parsed.wins === 'number' && parsed.wins >= 0
        ? Math.floor(parsed.wins)
        : 0
    const bestRoi =
      typeof parsed.bestRoi === 'number' && Number.isFinite(parsed.bestRoi)
        ? parsed.bestRoi
        : undefined
    return { gamesPlayed, wins, bestRoi }
  } catch {
    return EMPTY_STATS
  }
}

/** 写入持久化战绩；异常静默忽略（已在内存态保留）。 */
function writeStats(next: Stats): void {
  const store = safeStorage()
  if (!store) return
  try {
    store.setItem(STATS_KEY, JSON.stringify(next))
  } catch {
    // 配额满 / 受限环境：忽略，内存态仍有效
  }
}

/** 纯函数：把一局结果合并进战绩（便于测试 / 复用）。 */
export function mergeResult(prev: Stats, roi: number): Stats {
  const win = Number.isFinite(roi) && roi > 0
  const validRoi = Number.isFinite(roi) ? roi : 0
  return {
    gamesPlayed: prev.gamesPlayed + 1,
    wins: prev.wins + (win ? 1 : 0),
    bestRoi:
      prev.bestRoi === undefined ? validRoi : Math.max(prev.bestRoi, validRoi),
  }
}

/** useStats 返回值。 */
export interface UseStatsResult {
  /** 当前战绩（首次渲染即从 localStorage 同步读取）。 */
  stats: Stats
  /**
   * 记录一局结果：传入本局 roi（小数）。
   * 更新 gamesPlayed +1、bestRoi 取最大、roi>0 时 wins +1，并持久化。
   */
  record: (roi: number) => void
}

/**
 * 战绩持久化 hook。
 *
 * 注意：record 幂等性由调用方保证（同一局只调一次）；页面在进入结算分支时调用。
 */
export function useStats(): UseStatsResult {
  const [stats, setStats] = useState<Stats>(() => readStats())

  const record = useCallback((roi: number) => {
    setStats((prev) => {
      const next = mergeResult(prev, roi)
      writeStats(next)
      return next
    })
  }, [])

  return { stats, record }
}

export default useStats
