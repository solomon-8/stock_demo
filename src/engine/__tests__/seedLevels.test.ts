import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  createInitialState,
  applyAction,
  settle,
  isSkipToResumeVisible,
} from '../index'
import type { LevelPack } from '../../types/contract'

const LEVELS_DIR = join(__dirname, '../../assets/levels')

function loadLevel(file: string): LevelPack {
  return JSON.parse(readFileSync(join(LEVELS_DIR, file), 'utf-8')) as LevelPack
}

const levelFiles = readdirSync(LEVELS_DIR).filter(
  (f) => f.startsWith('level_') && f.endsWith('.json'),
)

describe('seed levels integration smoke', () => {
  it('found seed levels', () => {
    expect(levelFiles.length).toBeGreaterThan(0)
  })

  it.each(levelFiles)('plays %s end-to-end without throwing', (file) => {
    const level = loadLevel(file)
    let s = createInitialState(level)
    expect(s.currentDay).toBe(level.revealDays - 1)
    expect(s.cash).toBe(level.startCash)

    // simple strategy: buy half on day 9, then advance/skip until finished
    s = applyAction(s, level, { type: 'buy', cashRatio: 0.5 })

    let guard = 0
    while (s.status !== 'finished' && guard++ < 500) {
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
    expect(Number.isFinite(r.buyHoldRoi)).toBe(true)
    expect(r.reveal.outcomeTags).toEqual(level.reveal.outcomeTags)
    expect(r.finalAssets).toBeGreaterThanOrEqual(0)
  })

  it('delisted level produces near-total loss for a buyer', () => {
    const delistFile = levelFiles.find((f) => {
      const lv = loadLevel(f)
      return lv.events.some((e) => e.type === 'delist')
    })
    expect(delistFile).toBeTruthy()
    const level = loadLevel(delistFile!)
    let s = createInitialState(level)
    s = applyAction(s, level, { type: 'buy', cashRatio: 1 }) // all in
    while (s.status !== 'finished') s = applyAction(s, level, { type: 'advance' })
    const r = settle(s, level)
    // all-in then delisted → finalAssets only leftover cash (tiny)
    expect(r.finalAssets).toBeLessThan(level.startCash * 0.2)
    expect(r.buyHoldRoi).toBeLessThan(0)
  })

  it('long-halt level exposes skip button and can jump to settlement', () => {
    const longHaltFile = levelFiles.find((f) => {
      const lv = loadLevel(f)
      return lv.events.some(
        (e) =>
          e.type === 'halt' &&
          (e.resumeDay == null || e.resumeDay > lv.totalDays - 1),
      )
    })
    expect(longHaltFile).toBeTruthy()
    const level = loadLevel(longHaltFile!)
    let s = createInitialState(level)
    let sawButton = false
    let guard = 0
    while (s.status !== 'finished' && guard++ < 500) {
      if (isSkipToResumeVisible(s, level)) {
        sawButton = true
        s = applyAction(s, level, { type: 'skipToResume' })
      } else {
        s = applyAction(s, level, { type: 'advance' })
      }
    }
    expect(sawButton).toBe(true)
    expect(s.status).toBe('finished')
  })
})
