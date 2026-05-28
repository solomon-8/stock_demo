import { describe, it, expect } from 'vitest'
import {
  createInitialState,
  applyAction,
  settle,
  isSkipToResumeVisible,
} from '../index'
import type { LevelPack } from '../../types/contract'

// 真实退市股关卡（pipeline.build_delisted 产出）。用 vite 的 glob 导入，数量无关。
// import.meta.glob 是 vitest/vite 运行期特性，tsc 无此类型，故断言为 any。
const modules = (import.meta as any).glob(
  '../../assets/levels/generated_real/level_d*.json',
  { eager: true },
) as Record<string, unknown>
const levels: LevelPack[] = Object.values(modules).map(
  (m: any) => (m.default ?? m) as LevelPack,
)

describe('real delisted-stock levels play through the engine', () => {
  it('found at least one real delisted level', () => {
    expect(levels.length).toBeGreaterThan(0)
  })

  it.each(levels.map((l) => [l.levelId, l] as const))(
    'plays %s to a finished, finite, zeroed-out result',
    (_id, level) => {
      // 逐日推进；遇超长停牌就跳复牌；在「首个可交易日」全仓买入（这些关卡常以真实长期停牌开局，
      // day9 不可交易），然后持有到末日退市。
      let s = createInitialState(level)
      let bought = false
      let guard = 0
      while (s.status !== 'finished' && guard++ < 1000) {
        const day = level.days[s.currentDay]
        if (!bought && s.status === 'playing' && day?.tradable) {
          const next = applyAction(s, level, { type: 'buy', cashRatio: 1 })
          if (next !== s) {
            bought = true
            s = next
            continue
          }
        }
        if (isSkipToResumeVisible(s, level)) {
          s = applyAction(s, level, { type: 'skipToResume' })
        } else {
          s = applyAction(s, level, { type: 'advance' })
        }
      }
      expect(s.status).toBe('finished')

      const r = settle(s, level)
      expect(Number.isFinite(r.finalAssets)).toBe(true)
      expect(Number.isFinite(r.roi)).toBe(true)
      expect(['S', 'A', 'B', 'C', 'D']).toContain(r.grade)
      expect(r.reveal.outcomeTags).toContain('delisted')

      // 末日退市 → 持仓市值归零，结算只剩现金。
      expect(r.finalAssets).toBeCloseTo(s.cash, 6)
      // 持有退市股不可能盈利：总资产不超过初始本金（买到了就是巨亏，没买到则等于本金）。
      expect(r.finalAssets).toBeLessThanOrEqual(level.startCash + 1e-6)
    },
  )
})
