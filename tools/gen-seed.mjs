// @ts-check
/**
 * 种子关卡生成器。
 *
 * 用【可复现的种子伪随机】(自实现 LCG，不用语言内置随机源) 合成真实感关卡，
 * 严格符合 src/types/contract.ts 的 LevelPack / LevelIndex。
 *
 * 覆盖结局：surge / crash / delisted / long-halt / normal-halt / flat / st。
 *
 * 用法：node tools/gen-seed.mjs   或   npm run gen:seed
 *
 * 注意：本脚本为 ESM，无第三方依赖，纯 Node 标准库。
 */

import { mkdirSync, writeFileSync, readdirSync, rmSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const LEVELS_DIR = join(__dirname, '..', 'src', 'assets', 'levels')

const REVEAL_DAYS = 10
const START_CASH = 100000

/* ----------------------------- 可复现 PRNG (LCG) ----------------------------- */

/**
 * 线性同余发生器（数值参考 Numerical Recipes），完全可复现。
 * @param {number} seed
 */
function makeRng(seed) {
  // 保证为 32 位无符号
  let state = seed >>> 0
  const a = 1664525
  const c = 1013904223
  const m = 0x100000000 // 2^32
  /** @returns {number} [0,1) */
  function next() {
    state = (Math.imul(a, state) + c) >>> 0
    return state / m
  }
  return {
    /** [0,1) */
    next,
    /** [min,max) 浮点 */
    range: (min, max) => min + (max - min) * next(),
    /** [min,max] 整数 */
    int: (min, max) => Math.floor(min + (max - min + 1) * next()),
    /** 从数组中等概率取一个 */
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    /** 标准正态（Box-Muller） */
    gauss: () => {
      const u1 = Math.max(next(), 1e-12)
      const u2 = next()
      return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
    },
  }
}

/* ------------------------------- 数值工具 ------------------------------- */

const round2 = (x) => Math.round(x * 100) / 100
const round3 = (x) => Math.round(x * 1000) / 1000
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x))

/* ------------------------------ 指标计算 ------------------------------ */

/** 简单移动平均，长度不足返回 undefined。 */
function sma(closes, idx, period) {
  if (idx + 1 < period) return undefined
  let sum = 0
  for (let i = idx - period + 1; i <= idx; i++) sum += closes[i]
  return round3(sum / period)
}

/** RSI（Wilder 平滑近似，简化版用周期内均值）。 */
function computeRsi(closes, idx, period = 14) {
  if (idx < period) return undefined
  let gain = 0
  let loss = 0
  for (let i = idx - period + 1; i <= idx; i++) {
    const diff = closes[i] - closes[i - 1]
    if (diff >= 0) gain += diff
    else loss -= diff
  }
  const avgGain = gain / period
  const avgLoss = loss / period
  if (avgLoss === 0) return 100
  const rs = avgGain / avgLoss
  return round2(100 - 100 / (1 + rs))
}

/** 给所有 close 计算 EMA 序列。 */
function emaSeries(values, period) {
  const k = 2 / (period + 1)
  const out = new Array(values.length)
  let prev = values[0]
  out[0] = prev
  for (let i = 1; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k)
    out[i] = prev
  }
  return out
}

/** MACD：dif=ema12-ema26, dea=ema9(dif), macd=2*(dif-dea)。 */
function computeMacd(closes) {
  const ema12 = emaSeries(closes, 12)
  const ema26 = emaSeries(closes, 26)
  const dif = closes.map((_, i) => ema12[i] - ema26[i])
  const dea = emaSeries(dif, 9)
  const macd = dif.map((d, i) => 2 * (d - dea[i]))
  return { dif, dea, macd }
}

/* ---------------------------- 价格轨迹生成器 ---------------------------- */

/**
 * 结局类型定义。每种给一个日收益率漂移函数 driftFn(t, n) -> daily log-ish return。
 * 同时声明难度与可能的事件注入策略。
 */

/**
 * 生成一个关卡。
 * @param {ReturnType<typeof makeRng>} rng
 * @param {string} outcome
 * @param {string} levelId
 */
function buildLevel(rng, outcome, levelId) {
  const totalDays = rng.int(30, 60)
  const startPrice = round2(rng.range(6, 80))

  /** @type {import('../src/types/contract').MarketEvent[]} */
  const events = []
  const outcomeTags = [outcome]
  let difficulty = 'normal'

  // 事件计划：根据 outcome 决定停牌/ST/退市
  let haltStart = -1
  let haltLen = 0
  let stStart = -1
  let delistStart = -1

  switch (outcome) {
    case 'surge':
      difficulty = 'easy'
      break
    case 'crash':
      difficulty = 'normal'
      break
    case 'flat':
      difficulty = 'easy'
      break
    case 'normal-halt':
      difficulty = 'normal'
      haltStart = rng.int(REVEAL_DAYS + 2, totalDays - 8)
      haltLen = rng.int(2, 5)
      break
    case 'long-halt': {
      difficulty = 'hard'
      // 停牌跨度要超过停牌发生时玩家的"剩余交易日"。
      // 玩家剩余交易日 ~ totalDays - haltStart。让 haltLen 大于它。
      haltStart = rng.int(REVEAL_DAYS + 1, REVEAL_DAYS + 5)
      const remaining = totalDays - haltStart
      haltLen = remaining + rng.int(3, 8) // 显著超过剩余
      break
    }
    case 'st':
      difficulty = 'hard'
      stStart = rng.int(REVEAL_DAYS + 3, totalDays - 6)
      break
    case 'delisted':
      difficulty = 'hard'
      // 退市段足够长，价格连续跌停趋零，体现"后段归零、永远无法翻身"
      delistStart = rng.int(REVEAL_DAYS + 6, totalDays - 12)
      break
    default:
      break
  }

  // 漂移/波动参数
  let dailyDrift // 每日期望收益
  let dailyVol // 每日波动
  switch (outcome) {
    case 'surge':
      dailyDrift = rng.range(0.02, 0.045)
      dailyVol = rng.range(0.02, 0.04)
      break
    case 'crash':
      dailyDrift = -rng.range(0.025, 0.05)
      dailyVol = rng.range(0.025, 0.05)
      break
    case 'flat':
      dailyDrift = rng.range(-0.003, 0.003)
      dailyVol = rng.range(0.008, 0.018)
      break
    case 'delisted':
      dailyDrift = -rng.range(0.01, 0.03)
      dailyVol = rng.range(0.03, 0.06)
      break
    case 'st':
      dailyDrift = -rng.range(0.005, 0.02)
      dailyVol = rng.range(0.02, 0.04)
      break
    case 'normal-halt':
    case 'long-halt':
      dailyDrift = rng.range(-0.01, 0.01)
      dailyVol = rng.range(0.015, 0.03)
      break
    default:
      dailyDrift = 0
      dailyVol = 0.02
  }

  /** @type {import('../src/types/contract').DayBar[]} */
  const days = []
  const closes = [] // 用于指标
  let prevClose = startPrice
  let inSt = false

  // 记录 halt 段。
  // rawHaltEnd 是"理论复牌前最后一日"，可能超出本局窗口（超长停牌）。
  // 在窗口内的实际停牌日截断到 totalDays-1；只有当复牌日仍落在窗口内时才有 resumeDay。
  const rawHaltEnd = haltStart >= 0 ? haltStart + haltLen - 1 : -1
  const haltEnd = haltStart >= 0 ? Math.min(rawHaltEnd, totalDays - 1) : -1
  const rawResumeDay = haltStart >= 0 ? rawHaltEnd + 1 : -1
  // 复牌日在窗口内 => 真实复牌（normal-halt）；否则本局永不复牌（long-halt），无 resumeDay。
  const resumeDay = rawResumeDay >= 0 && rawResumeDay < totalDays ? rawResumeDay : -1

  for (let day = 0; day < totalDays; day++) {
    const isHalted = haltStart >= 0 && day >= haltStart && day <= haltEnd
    // ST 段从 stStart 到结束
    if (stStart >= 0 && day === stStart) inSt = true
    // 退市：delistStart 当天起持仓将归零，价格快速塌缩
    const isDelisting = delistStart >= 0 && day >= delistStart

    if (isHalted) {
      // 停牌日：价格冻结，沿用前收，volume=0，不可交易
      const p = round2(prevClose)
      days.push({
        day,
        open: p,
        high: p,
        low: p,
        close: p,
        volume: 0,
        turnover: 0,
        volumeRatio: 0,
        tradable: false,
        priceLimit: inSt ? 0.05 : null,
      })
      closes.push(p)
      // prevClose 不变
      continue
    }

    // 复牌首日：跳空（normal-halt 体现跳空）
    let drift = dailyDrift
    let vol = dailyVol
    let gap = 0
    if (resumeDay >= 0 && day === resumeDay) {
      // 复牌跳空，方向随机但偏空概率略高（贴近现实）
      gap = rng.range(-0.12, 0.08)
    }
    if (isDelisting) {
      // 退市段：连续跌停式塌缩，价格快速趋零（持仓价值的结算归零由引擎依据 delist 事件处理）
      drift = -0.095
      vol = 0.01
    }

    // 当日涨跌幅（log-ish 用普通收益近似）
    let ret = drift + vol * rng.gauss() + gap
    // ST/退市/正常的涨跌幅限制
    const limit = inSt || isDelisting ? 0.05 : 0.1
    ret = clamp(ret, -limit, limit)

    const open = round2(prevClose * (1 + (gap !== 0 ? gap * 0.6 : vol * rng.gauss() * 0.3)))
    let close = round2(prevClose * (1 + ret))
    if (close <= 0.5) close = 0.5 // 价格地板
    // high/low 包裹 open/close
    const hi = Math.max(open, close)
    const lo = Math.min(open, close)
    const high = round2(hi * (1 + Math.abs(rng.gauss()) * vol * 0.4))
    const low = round2(lo * (1 - Math.abs(rng.gauss()) * vol * 0.4))

    // 成交量：与波动正相关，退市/复牌放量
    let baseVol = rng.range(2e6, 1.5e7)
    if (isDelisting) baseVol *= rng.range(1.5, 3)
    if (resumeDay >= 0 && day === resumeDay) baseVol *= rng.range(1.8, 3.5)
    const volume = Math.round(baseVol)

    const turnover = round2(clamp((volume / 2e8) * 100, 0.05, 25))
    const volumeRatio = round2(clamp(0.6 + Math.abs(rng.gauss()) * 0.9, 0.2, 6))

    days.push({
      day,
      open: round2(clamp(open, low, high)),
      high,
      low: round2(Math.min(low, open, close)),
      close,
      volume,
      turnover,
      volumeRatio,
      tradable: true,
      priceLimit: inSt || isDelisting ? 0.05 : null,
    })
    closes.push(close)
    prevClose = close
  }

  // 注入预计算指标
  const { dif, dea, macd } = computeMacd(closes)
  for (let i = 0; i < days.length; i++) {
    const d = days[i]
    d.ma5 = sma(closes, i, 5)
    d.ma10 = sma(closes, i, 10)
    d.ma20 = sma(closes, i, 20)
    d.rsi = computeRsi(closes, i, 14)
    d.dif = round3(dif[i])
    d.dea = round3(dea[i])
    d.macd = round3(macd[i])
  }

  // 写事件
  if (haltStart >= 0) {
    /** @type {import('../src/types/contract').MarketEvent} */
    const haltEvent = { type: 'halt', startDay: haltStart, endDay: haltEnd }
    // 仅当本局窗口内确有复牌首日时写 resumeDay；超长停牌（永不复牌）则省略。
    if (resumeDay >= 0) haltEvent.resumeDay = resumeDay
    events.push(haltEvent)
  }
  if (stStart >= 0) {
    events.push({ type: 'st', startDay: stStart, endDay: totalDays - 1 })
    if (!outcomeTags.includes('st')) outcomeTags.push('st')
  }
  if (delistStart >= 0) {
    events.push({ type: 'delist', startDay: delistStart, endDay: totalDays - 1 })
  }

  const story = buildStory(outcome, { totalDays, haltStart, haltLen, stStart, delistStart, resumeDay })

  /** @type {import('../src/types/contract').LevelPack} */
  const pack = {
    levelId,
    totalDays,
    revealDays: REVEAL_DAYS,
    startCash: START_CASH,
    days,
    events,
    reveal: { outcomeTags, story },
  }
  return { pack, difficulty }
}

/** 结局揭盘文案（可含真实代号，但游戏过程中不暴露）。 */
function buildStory(outcome, ctx) {
  switch (outcome) {
    case 'surge':
      return '复盘：这是一只处于景气上行周期的成长股，业绩超预期叠加资金抱团，区间走出连续上涨行情。'
    case 'crash':
      return '复盘：这是一只高位个股，遭遇业绩暴雷与杀估值，区间出现快速回撤。落袋为安才是赢家。'
    case 'flat':
      return '复盘：这是一只低波动的价值股，缺乏催化、量能温吞，整段时间维持区间震荡横盘。'
    case 'normal-halt':
      return `复盘：该股于第 ${ctx.haltStart} 日起因重大事项停牌 ${ctx.haltLen} 个交易日，第 ${ctx.resumeDay} 日复牌跳空。停牌期间无法交易、价格冻结。`
    case 'long-halt':
      return `复盘：该股于第 ${ctx.haltStart} 日起进入超长停牌（${ctx.haltLen} 个交易日），停牌跨度超过你本局剩余交易日——若不点"跳到复牌首日"，将永远等不到复牌。`
    case 'st':
      return `复盘：该股于第 ${ctx.stStart} 日被实施 ST（其他风险警示），此后每日涨跌幅收窄至 ±5%，流动性恶化。异常的窄幅波动其实早有暗示。`
    case 'delisted':
      return `复盘：该股于第 ${ctx.delistStart} 日触发退市，持仓价值归零、永远无法翻身。这正是"接飞刀"最惨痛的结局。`
    default:
      return '复盘：普通行情。'
  }
}

/* ------------------------------- 校验 ------------------------------- */

/** 轻量自检，保证产出符合契约约束。 */
function validate(pack) {
  const errs = []
  if (pack.totalDays < 30 || pack.totalDays > 60) errs.push('totalDays out of [30,60]')
  if (pack.revealDays !== REVEAL_DAYS) errs.push('revealDays != 10')
  if (pack.startCash !== START_CASH) errs.push('startCash != 100000')
  if (pack.days.length !== pack.totalDays) errs.push('days length != totalDays')
  pack.days.forEach((d, i) => {
    if (d.day !== i) errs.push(`day index mismatch at ${i}`)
    if (!(d.low <= d.open && d.open <= d.high)) errs.push(`OHLC open out of range at day ${i}`)
    if (!(d.low <= d.close && d.close <= d.high)) errs.push(`OHLC close out of range at day ${i}`)
    if (d.tradable === false && d.volume !== 0) errs.push(`halted day has volume at ${i}`)
  })
  for (const ev of pack.events) {
    if (ev.startDay < 0 || ev.startDay >= pack.totalDays) errs.push(`event startDay OOB (${ev.type})`)
    if (ev.endDay != null && (ev.endDay < ev.startDay || ev.endDay >= pack.totalDays)) {
      errs.push(`event endDay OOB (${ev.type})`)
    }
    if (ev.resumeDay != null && (ev.resumeDay < 0 || ev.resumeDay >= pack.totalDays)) {
      errs.push(`event resumeDay OOB (${ev.type})`)
    }
  }
  return errs
}

/* ------------------------------- 主流程 ------------------------------- */

function main() {
  // 至少 12 个，覆盖全部 7 种结局；多出来的随机补充。
  const required = [
    'surge', 'crash', 'delisted', 'long-halt', 'normal-halt', 'flat', 'st',
  ]
  const extra = ['surge', 'crash', 'st', 'normal-halt', 'flat']
  const plan = [...required, ...extra] // 12 个

  // 清空旧关卡（保持原子、可复现）
  if (existsSync(LEVELS_DIR)) {
    for (const f of readdirSync(LEVELS_DIR)) {
      if (f.startsWith('level_') && f.endsWith('.json')) {
        rmSync(join(LEVELS_DIR, f))
      }
    }
  } else {
    mkdirSync(LEVELS_DIR, { recursive: true })
  }

  // 全局主种子固定 -> 完全可复现
  const masterRng = makeRng(20260529)

  /** @type {import('../src/types/contract').LevelIndexEntry[]} */
  const indexEntries = []
  const tagCount = {}

  plan.forEach((outcome, i) => {
    const id = `${String(i + 1).padStart(4, '0')}`
    const levelId = `level_${id}`
    // 每关一个派生种子，仍由主种子决定 -> 可复现
    const rng = makeRng(masterRng.int(1, 0x7fffffff))
    const { pack, difficulty } = buildLevel(rng, outcome, levelId)

    const errs = validate(pack)
    if (errs.length) {
      console.error(`[FAIL] ${levelId} (${outcome}) 校验失败:`, errs)
      process.exitCode = 1
    }

    const file = `level_${id}.json`
    writeFileSync(join(LEVELS_DIR, file), JSON.stringify(pack, null, 2) + '\n', 'utf8')

    indexEntries.push({
      levelId,
      difficulty,
      outcomeTags: pack.reveal.outcomeTags,
      totalDays: pack.totalDays,
      file,
    })
    for (const t of pack.reveal.outcomeTags) tagCount[t] = (tagCount[t] || 0) + 1
  })

  /** @type {import('../src/types/contract').LevelIndex} */
  const index = { levels: indexEntries }
  writeFileSync(join(LEVELS_DIR, 'index.json'), JSON.stringify(index, null, 2) + '\n', 'utf8')

  console.log(`生成 ${indexEntries.length} 个关卡 -> ${LEVELS_DIR}`)
  console.log('outcomeTag 分布:', JSON.stringify(tagCount))
  for (const e of indexEntries) {
    console.log(`  ${e.levelId}  ${e.difficulty.padEnd(6)}  days=${e.totalDays}  tags=${e.outcomeTags.join(',')}`)
  }
}

main()
