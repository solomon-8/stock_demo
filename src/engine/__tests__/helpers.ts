/**
 * 测试工具：构造合成关卡包，便于精确覆盖各类边界。
 */
import type { DayBar, LevelPack, MarketEvent } from '../../types/contract'

export interface MakeBarOpts {
  close?: number
  tradable?: boolean
  priceLimit?: number | null
  volume?: number
}

/** 造一根 K 线，open/high/low 由 close 简单派生，保证 low<=open/close<=high。 */
export function makeBar(day: number, opts: MakeBarOpts = {}): DayBar {
  const close = opts.close ?? 100
  const tradable = opts.tradable ?? true
  return {
    day,
    open: close,
    high: close,
    low: close,
    close,
    volume: opts.volume ?? 1000,
    tradable,
    priceLimit: opts.priceLimit ?? null,
  }
}

export interface MakeLevelOpts {
  levelId?: string
  totalDays?: number
  revealDays?: number
  startCash?: number
  /** 每日收盘价数组（长度应 = totalDays）；缺省全部 100。 */
  closes?: number[]
  events?: MarketEvent[]
  /** 指定哪些 day 停牌（tradable=false）。 */
  haltDays?: number[]
  /** 指定哪些 day 有 ST 限幅，及限幅值。 */
  priceLimits?: Record<number, number>
  outcomeTags?: string[]
  story?: string
}

export function makeLevel(opts: MakeLevelOpts = {}): LevelPack {
  const totalDays = opts.totalDays ?? 30
  const revealDays = opts.revealDays ?? 10
  const startCash = opts.startCash ?? 100000
  const haltSet = new Set(opts.haltDays ?? [])
  const limits = opts.priceLimits ?? {}

  const days: DayBar[] = []
  for (let d = 0; d < totalDays; d++) {
    const close = opts.closes ? opts.closes[d] : 100
    days.push(
      makeBar(d, {
        close,
        tradable: !haltSet.has(d),
        priceLimit: limits[d] ?? null,
        volume: haltSet.has(d) ? 0 : 1000,
      }),
    )
  }

  return {
    levelId: opts.levelId ?? 'test_level',
    totalDays,
    revealDays,
    startCash,
    days,
    events: opts.events ?? [],
    reveal: {
      outcomeTags: opts.outcomeTags ?? ['flat'],
      story: opts.story ?? 'test story',
    },
  }
}
