import { describe, it, expect } from 'vitest'
import {
  DEFAULT_FEE_RATE,
  createInitialState,
  applyAction,
  settle,
  isSkipToResumeVisible,
  gradeOf,
} from '../index'
import { makeLevel } from './helpers'

describe('createInitialState', () => {
  it('initializes cash/shares/day per contract', () => {
    const level = makeLevel({ startCash: 100000, revealDays: 10, totalDays: 30 })
    const s = createInitialState(level)
    expect(s.cash).toBe(100000)
    expect(s.shares).toBe(0)
    expect(s.currentDay).toBe(9) // revealDays - 1
    expect(s.totalDays).toBe(30)
    expect(s.feeRate).toBe(DEFAULT_FEE_RATE)
    expect(s.status).toBe('playing')
    expect(s.history).toEqual([])
  })
})

describe('buy with fee', () => {
  it('buys floor(cashRatio*cash / (price*(1+fee))) shares and deducts fee', () => {
    const level = makeLevel({ closes: Array(30).fill(100) })
    const s0 = createInitialState(level) // cash 100000, price 100, fee 0.0005
    const s1 = applyAction(s0, level, { type: 'buy', cashRatio: 1 })
    // perShareCost = 100*1.0005 = 100.05 ; floor(100000/100.05) = 999
    expect(s1.shares).toBe(999)
    const cost = 999 * 100
    const fee = cost * DEFAULT_FEE_RATE
    expect(s1.cash).toBeCloseTo(100000 - cost - fee, 6)
    expect(s1.history).toHaveLength(1)
    expect(s1.history[0]).toMatchObject({ action: 'buy', price: 100, shares: 999 })
  })

  it('partial buy by cashRatio', () => {
    const level = makeLevel({ closes: Array(30).fill(100) })
    const s0 = createInitialState(level)
    const s1 = applyAction(s0, level, { type: 'buy', cashRatio: 0.5 })
    // budget 50000 ; floor(50000/100.05)=499
    expect(s1.shares).toBe(499)
  })

  it('fee=0 buys exactly floor(cash/price)', () => {
    const level = makeLevel({ closes: Array(30).fill(100) })
    const s0 = { ...createInitialState(level), feeRate: 0 }
    const s1 = applyAction(s0, level, { type: 'buy', cashRatio: 1 })
    expect(s1.shares).toBe(1000)
    expect(s1.cash).toBe(0)
  })

  it('no-op when cashRatio<=0 or insufficient cash', () => {
    const level = makeLevel({ closes: Array(30).fill(100) })
    const s0 = createInitialState(level)
    expect(applyAction(s0, level, { type: 'buy', cashRatio: 0 })).toBe(s0)
    const poor = { ...s0, cash: 1 }
    expect(applyAction(poor, level, { type: 'buy', cashRatio: 1 })).toBe(poor)
  })

  it('clamps cashRatio>1 to 1', () => {
    const level = makeLevel({ closes: Array(30).fill(100) })
    const s0 = createInitialState(level)
    const s1 = applyAction(s0, level, { type: 'buy', cashRatio: 5 })
    expect(s1.shares).toBe(999)
  })
})

describe('sell with fee', () => {
  it('sells floor(shareRatio*shares) and credits cash minus fee', () => {
    const level = makeLevel({ closes: Array(30).fill(100) })
    let s = createInitialState(level)
    s = applyAction(s, level, { type: 'buy', cashRatio: 1 }) // 999 shares
    const cashBefore = s.cash
    const s2 = applyAction(s, level, { type: 'sell', shareRatio: 1 })
    expect(s2.shares).toBe(0)
    const gross = 999 * 100
    const fee = gross * DEFAULT_FEE_RATE
    expect(s2.cash).toBeCloseTo(cashBefore + gross - fee, 6)
    expect(s2.history.at(-1)).toMatchObject({ action: 'sell', shares: 0 })
  })

  it('partial sell by shareRatio', () => {
    const level = makeLevel({ closes: Array(30).fill(100) })
    let s = createInitialState(level)
    s = applyAction(s, level, { type: 'buy', cashRatio: 1 }) // 999
    const s2 = applyAction(s, level, { type: 'sell', shareRatio: 0.5 })
    expect(s2.shares).toBe(999 - Math.floor(999 * 0.5)) // 999-499=500
  })

  it('no-op selling with zero shares', () => {
    const level = makeLevel({ closes: Array(30).fill(100) })
    const s0 = createInitialState(level)
    expect(applyAction(s0, level, { type: 'sell', shareRatio: 1 })).toBe(s0)
  })
})

describe('hold and immutability', () => {
  it('hold returns same state reference', () => {
    const level = makeLevel()
    const s0 = createInitialState(level)
    expect(applyAction(s0, level, { type: 'hold' })).toBe(s0)
  })

  it('buy does not mutate input state', () => {
    const level = makeLevel({ closes: Array(30).fill(100) })
    const s0 = createInitialState(level)
    const snapshot = JSON.stringify(s0)
    applyAction(s0, level, { type: 'buy', cashRatio: 1 })
    expect(JSON.stringify(s0)).toBe(snapshot)
  })
})

describe('advance', () => {
  it('increments currentDay and refreshes status', () => {
    const level = makeLevel({ totalDays: 30 })
    const s0 = createInitialState(level)
    const s1 = applyAction(s0, level, { type: 'advance' })
    expect(s1.currentDay).toBe(10)
    expect(s1.status).toBe('playing')
  })

  it('advancing past last day finishes the game', () => {
    const level = makeLevel({ totalDays: 12, revealDays: 10 })
    let s = createInitialState(level) // currentDay 9
    s = applyAction(s, level, { type: 'advance' }) // 10
    s = applyAction(s, level, { type: 'advance' }) // 11 = last
    expect(s.currentDay).toBe(11)
    expect(s.status).toBe('playing')
    s = applyAction(s, level, { type: 'advance' }) // past last
    expect(s.status).toBe('finished')
    // further actions are no-op
    expect(applyAction(s, level, { type: 'advance' })).toBe(s)
  })
})

describe('halt (suspension) freezing', () => {
  const level = makeLevel({
    totalDays: 38,
    closes: Array(38).fill(100),
    haltDays: [22, 23, 24],
    events: [{ type: 'halt', startDay: 22, endDay: 24, resumeDay: 25 }],
  })

  it('buy/sell are no-op while halted; status=halted', () => {
    let s = createInitialState(level)
    s = applyAction(s, level, { type: 'buy', cashRatio: 0.5 }) // own some shares pre-halt
    // advance to halt day 22
    while (s.currentDay < 22) s = applyAction(s, level, { type: 'advance' })
    expect(s.status).toBe('halted')
    const before = s
    const tryBuy = applyAction(s, level, { type: 'buy', cashRatio: 1 })
    const trySell = applyAction(s, level, { type: 'sell', shareRatio: 1 })
    expect(tryBuy).toBe(before)
    expect(trySell).toBe(before)
  })

  it('resumes to playing after resumeDay', () => {
    let s = createInitialState(level)
    while (s.currentDay < 25) s = applyAction(s, level, { type: 'advance' })
    expect(s.currentDay).toBe(25)
    expect(s.status).toBe('playing')
  })

  it('skipToResume button NOT visible for normal halt', () => {
    let s = createInitialState(level)
    while (s.currentDay < 22) s = applyAction(s, level, { type: 'advance' })
    expect(isSkipToResumeVisible(s, level)).toBe(false)
  })
})

describe('long halt (skipToResume)', () => {
  it('button visible during long halt; skip jumps to settlement when no resume in window', () => {
    const level = makeLevel({
      totalDays: 54,
      closes: Array(54).fill(100),
      haltDays: Array.from({ length: 39 }, (_, i) => 15 + i), // 15..53
      events: [{ type: 'halt', startDay: 15, endDay: 53 }], // no resumeDay
    })
    let s = createInitialState(level)
    while (s.currentDay < 15) s = applyAction(s, level, { type: 'advance' })
    expect(s.status).toBe('halted')
    expect(isSkipToResumeVisible(s, level)).toBe(true)
    const skipped = applyAction(s, level, { type: 'skipToResume' })
    expect(skipped.currentDay).toBe(53) // last day
    expect(skipped.status).toBe('finished')
  })

  it('skip jumps to resumeDay when a long halt resumes within the window', () => {
    const level = makeLevel({
      totalDays: 60,
      closes: Array(60).fill(100),
      haltDays: Array.from({ length: 40 }, (_, i) => 15 + i), // 15..54
      // span = resumeDay(55) - startDay(15) = 40 > LONG_HALT_SKIP_THRESHOLD(5)
      // → long halt; resume 55 is in window → skip jumps to it.
      events: [{ type: 'halt', startDay: 15, endDay: 54, resumeDay: 55 }],
    })
    let s = createInitialState(level)
    while (s.currentDay < 15) s = applyAction(s, level, { type: 'advance' })
    expect(s.status).toBe('halted')
    expect(isSkipToResumeVisible(s, level)).toBe(true)
    const skipped = applyAction(s, level, { type: 'skipToResume' })
    expect(skipped.currentDay).toBe(55) // jumped to resume day
    expect(skipped.status).toBe('playing')
  })

  it('a short in-window halt (span <= threshold) is NOT long; advance through it', () => {
    const level = makeLevel({
      totalDays: 40,
      closes: Array(40).fill(100),
      haltDays: [20, 21, 22], // span = resume(23) - start(20) = 3 <= 5
      events: [{ type: 'halt', startDay: 20, endDay: 22, resumeDay: 23 }],
    })
    let s = createInitialState(level)
    while (s.currentDay < 20) s = applyAction(s, level, { type: 'advance' })
    expect(s.status).toBe('halted')
    expect(isSkipToResumeVisible(s, level)).toBe(false)
    expect(applyAction(s, level, { type: 'skipToResume' })).toBe(s) // no-op
  })

  it('skipToResume is no-op when not in a long halt', () => {
    const level = makeLevel({ totalDays: 30, closes: Array(30).fill(100) })
    const s = createInitialState(level)
    expect(applyAction(s, level, { type: 'skipToResume' })).toBe(s)
  })

  it('long halt with resumeDay just past window jumps to settlement', () => {
    const level = makeLevel({
      totalDays: 30,
      closes: Array(30).fill(100),
      haltDays: Array.from({ length: 20 }, (_, i) => 10 + i), // 10..29
      events: [{ type: 'halt', startDay: 10, endDay: 29, resumeDay: 40 }], // resume out of window
    })
    let s = createInitialState(level)
    s = applyAction(s, level, { type: 'advance' }) // day 10 halted
    expect(s.status).toBe('halted')
    expect(isSkipToResumeVisible(s, level)).toBe(true)
    const skipped = applyAction(s, level, { type: 'skipToResume' })
    expect(skipped.currentDay).toBe(29)
    expect(skipped.status).toBe('finished')
  })
})

describe('delist (退市) zeroing', () => {
  const level = makeLevel({
    totalDays: 30,
    closes: Array(30).fill(100),
    events: [{ type: 'delist', startDay: 17, endDay: 29 }],
  })

  it('status becomes finished when reaching delist day', () => {
    let s = createInitialState(level)
    s = applyAction(s, level, { type: 'buy', cashRatio: 1 }) // buy at day 9
    while (s.currentDay < 17 && s.status !== 'finished')
      s = applyAction(s, level, { type: 'advance' })
    expect(s.currentDay).toBe(17)
    expect(s.status).toBe('finished')
  })

  it('settle zeroes holdings value after delist', () => {
    let s = createInitialState(level)
    s = applyAction(s, level, { type: 'buy', cashRatio: 1 })
    const cashAfterBuy = s.cash
    while (s.currentDay < 17) s = applyAction(s, level, { type: 'advance' })
    const r = settle(s, level)
    // holdings worth 0, only leftover cash remains
    expect(r.finalAssets).toBeCloseTo(cashAfterBuy, 6)
    expect(r.roi).toBeLessThan(0) // lost the invested portion
  })

  it('buy/sell no-op once delisted', () => {
    let s = createInitialState(level)
    while (s.status !== 'finished') s = applyAction(s, level, { type: 'advance' })
    expect(applyAction(s, level, { type: 'buy', cashRatio: 1 })).toBe(s)
    expect(applyAction(s, level, { type: 'sell', shareRatio: 1 })).toBe(s)
  })
})

describe('ST price limit clamping', () => {
  it('clamps trade price to prevClose*(1+limit) when close exceeds limit', () => {
    // day34 close 100, day35 close 130 but priceLimit 0.05 → clamp to 105
    const closes = Array(40).fill(100)
    closes[35] = 130
    const level = makeLevel({
      totalDays: 40,
      closes,
      priceLimits: { 35: 0.05 },
      events: [{ type: 'st', startDay: 35, endDay: 39 }],
    })
    let s = createInitialState(level)
    while (s.currentDay < 35) s = applyAction(s, level, { type: 'advance' })
    const s2 = applyAction(s, level, { type: 'buy', cashRatio: 1 })
    expect(s2.history.at(-1)!.price).toBeCloseTo(105, 6) // clamped, not 130
  })

  it('clamps downside to prevClose*(1-limit)', () => {
    const closes = Array(40).fill(100)
    closes[35] = 50 // big drop
    const level = makeLevel({
      totalDays: 40,
      closes,
      priceLimits: { 35: 0.05 },
      events: [{ type: 'st', startDay: 35, endDay: 39 }],
    })
    let s = createInitialState(level)
    s = applyAction(s, level, { type: 'buy', cashRatio: 1 }) // own shares
    while (s.currentDay < 35) s = applyAction(s, level, { type: 'advance' })
    const s2 = applyAction(s, level, { type: 'sell', shareRatio: 1 })
    expect(s2.history.at(-1)!.price).toBeCloseTo(95, 6) // 100*0.95, not 50
  })

  it('no clamping when close within limit', () => {
    const closes = Array(40).fill(100)
    closes[35] = 103
    const level = makeLevel({
      totalDays: 40,
      closes,
      priceLimits: { 35: 0.05 },
    })
    let s = createInitialState(level)
    while (s.currentDay < 35) s = applyAction(s, level, { type: 'advance' })
    const s2 = applyAction(s, level, { type: 'buy', cashRatio: 1 })
    expect(s2.history.at(-1)!.price).toBeCloseTo(103, 6)
  })
})

describe('settle / roi / buy&hold benchmark', () => {
  it('roi reflects gains and beats buy&hold when timing is better', () => {
    // price flat 100 until day9, then rises to 200 by end
    const closes = Array(30).fill(100)
    for (let d = 10; d < 30; d++) closes[d] = 100 + (d - 9) * 5 // ends 200
    const level = makeLevel({ totalDays: 30, closes })
    let s = createInitialState(level)
    s = applyAction(s, level, { type: 'buy', cashRatio: 1 }) // buy at 100
    while (s.currentDay < 29) s = applyAction(s, level, { type: 'advance' })
    const r = settle(s, level)
    expect(r.roi).toBeGreaterThan(0.9) // ~ doubled
    // buy&hold also entered at day9 close 100 → similar; player tied or close
    expect(r.buyHoldRoi).toBeGreaterThan(0.9)
  })

  it('player who sells before crash beats buy&hold', () => {
    const closes = Array(30).fill(100)
    for (let d = 10; d < 30; d++) closes[d] = 100 - (d - 9) * 4 // crashes to 20
    const level = makeLevel({ totalDays: 30, closes })
    let s = createInitialState(level)
    s = applyAction(s, level, { type: 'buy', cashRatio: 1 })
    // hold to day 12 (price 88) then sell all, sit in cash
    while (s.currentDay < 12) s = applyAction(s, level, { type: 'advance' })
    s = applyAction(s, level, { type: 'sell', shareRatio: 1 })
    while (s.currentDay < 29) s = applyAction(s, level, { type: 'advance' })
    const r = settle(s, level)
    expect(r.roi).toBeGreaterThan(r.buyHoldRoi) // avoided the crash
    expect(r.buyHoldRoi).toBeLessThan(0)
  })

  it('all-cash player has roi ~0 and matching grade', () => {
    const level = makeLevel({ totalDays: 30, closes: Array(30).fill(100) })
    let s = createInitialState(level)
    while (s.currentDay < 29) s = applyAction(s, level, { type: 'advance' })
    const r = settle(s, level)
    expect(r.roi).toBeCloseTo(0, 6)
    // buy&hold on flat price still pays a one-off buy fee ≈ feeRate → tiny drag
    expect(r.buyHoldRoi).toBeCloseTo(0, 2)
    expect(r.buyHoldRoi).toBeLessThan(0)
  })

  it('exposes reveal payload from level', () => {
    const level = makeLevel({ outcomeTags: ['surge'], story: 'it mooned' })
    const r = settle(createInitialState(level), level)
    expect(r.reveal).toEqual({ outcomeTags: ['surge'], story: 'it mooned' })
  })
})

describe('gradeOf', () => {
  it('S for big win beating benchmark', () => {
    expect(gradeOf(0.6, 0.1)).toBe('S')
  })
  it('A for solid win beating benchmark', () => {
    expect(gradeOf(0.3, 0.1)).toBe('A')
  })
  it('not S if not beating benchmark even if high roi', () => {
    expect(gradeOf(0.6, 0.7)).toBe('B') // roi>=0 and roi>=0.1
  })
  it('B for non-negative with decent absolute roi', () => {
    expect(gradeOf(0.15, 0.5)).toBe('B')
  })
  it('B when beating benchmark while flat', () => {
    expect(gradeOf(0.02, -0.3)).toBe('B')
  })
  it('C for small loss', () => {
    expect(gradeOf(-0.1, -0.5)).toBe('C')
  })
  it('D for big loss', () => {
    expect(gradeOf(-0.4, -0.6)).toBe('D')
  })
})

describe('random length boundaries', () => {
  it.each([30, 45, 60])('plays a full %i-day game to finish', (totalDays) => {
    const level = makeLevel({ totalDays, closes: Array(totalDays).fill(100) })
    let s = createInitialState(level)
    let guard = 0
    while (s.status !== 'finished' && guard++ < 200) {
      s = applyAction(s, level, { type: 'advance' })
    }
    expect(s.status).toBe('finished')
    expect(s.currentDay).toBe(totalDays - 1)
  })
})

// Regression tests for bugs found in adversarial review (2026-05-29).
describe('regression: ST-clamp valuation consistency (no phantom profit)', () => {
  it('buying on an ST-clamped day yields ~0 instant roi (only fee drag), not a jump', () => {
    // day35 close 130 but ST limit 0.05 vs prevClose 100 → clamp to 105.
    const closes = Array(40).fill(100)
    closes[35] = 130
    const level = makeLevel({
      totalDays: 40,
      closes,
      priceLimits: { 35: 0.05 },
      events: [{ type: 'st', startDay: 35, endDay: 39 }],
    })
    let s = createInitialState(level)
    while (s.currentDay < 35) s = applyAction(s, level, { type: 'advance' })
    s = applyAction(s, level, { type: 'buy', cashRatio: 1 }) // fills at clamped 105
    const r = settle(s, level) // valued at clamped 105 too, NOT raw 130
    // Before the fix this was ~ +0.237 phantom roi. Now it must be ~0 (slightly negative from fee).
    expect(r.roi).toBeLessThanOrEqual(0)
    expect(r.roi).toBeGreaterThan(-0.01)
  })
})

describe('regression: halt without endDay is bounded by resumeDay', () => {
  it('resumes to playing at resumeDay even when endDay is omitted', () => {
    const level = makeLevel({
      totalDays: 40,
      closes: Array(40).fill(100),
      haltDays: [20, 21, 22, 23, 24], // tradable=false 20..24
      events: [{ type: 'halt', startDay: 20, resumeDay: 25 }], // no endDay
    })
    let s = createInitialState(level)
    while (s.currentDay < 25) s = applyAction(s, level, { type: 'advance' })
    expect(s.currentDay).toBe(25)
    expect(s.status).toBe('playing') // not stuck halted forever
  })
})

describe('regression: ST limit falls back to default when bar lacks priceLimit', () => {
  it('clamps trade price during an ST event even if priceLimit field is missing', () => {
    const closes = Array(40).fill(100)
    closes[35] = 200 // huge jump, no per-bar priceLimit stamped
    const level = makeLevel({
      totalDays: 40,
      closes,
      // note: NO priceLimits map — only the ST event window
      events: [{ type: 'st', startDay: 35, endDay: 39 }],
    })
    let s = createInitialState(level)
    while (s.currentDay < 35) s = applyAction(s, level, { type: 'advance' })
    const s2 = applyAction(s, level, { type: 'buy', cashRatio: 1 })
    // fallback 0.05 → prevClose 100 → clamp to 105, not 200
    expect(s2.history.at(-1)!.price).toBeCloseTo(105, 6)
  })
})

describe('regression: skipToResume stops at an intervening delist', () => {
  it('lands on the delist day (holdings zeroed) instead of blowing past it', () => {
    const level = makeLevel({
      totalDays: 40,
      closes: Array(40).fill(100),
      haltDays: Array.from({ length: 25 }, (_, i) => 12 + i), // 12..36
      events: [
        { type: 'halt', startDay: 12, endDay: 36 }, // long, no resume
        { type: 'delist', startDay: 20, endDay: 39 }, // delist mid-halt
      ],
    })
    let s = createInitialState(level)
    s = applyAction(s, level, { type: 'buy', cashRatio: 1 }) // hold shares into the halt
    while (s.currentDay < 12) s = applyAction(s, level, { type: 'advance' })
    expect(isSkipToResumeVisible(s, level)).toBe(true)
    const skipped = applyAction(s, level, { type: 'skipToResume' })
    expect(skipped.currentDay).toBe(20) // stops at delist start, not last day
    expect(skipped.status).toBe('finished')
    const r = settle(skipped, level)
    expect(r.finalAssets).toBeCloseTo(skipped.cash, 6) // holdings zeroed by delist
  })
})
