/**
 * 关卡加载器
 * ============
 * 负责从 src/assets/levels/ 读取关卡索引 (index.json) 与单个关卡包 (level_*.json)，
 * 并提供选关策略。
 *
 * 读取方式（为何用静态 import 而非 fetch）：
 * - 目标构建为 Taro H5（webpack5）。`import.meta.glob` 是 Vite 专有语法，webpack 下不可用；
 *   `require.context` 在 TS + Taro 下类型与可移植性较差。
 * - 项目 tsconfig 已开启 `resolveJsonModule`，因此采用「静态 import JSON + 显式注册表」的方式：
 *   - 编译期即把 JSON 打进 bundle，运行时零网络请求，离线可玩，H5 / 小程序 / vitest(node) 通用；
 *   - 注册表显式列出全部关卡文件，新增关卡只需在 LEVEL_MODULES 增一行（也可由 gen:seed 脚本维护）。
 * - 若未来需要按需远程拉取，可在 loadLevel 内替换为 fetch + 同样的校验逻辑，对外 API 不变。
 *
 * 错误处理策略：
 * - 所有「数据损坏 / 字段缺失 / 找不到关卡」的异常统一抛出 LevelLoadError，
 *   带 code 与 levelId/file 上下文，调用方可 catch 后跳过换关（见设计文档 §7）。
 * - 校验为「结构性校验」：只检查下游引擎依赖的关键字段与基本不变量，
 *   不做业务级深度校验（那是引擎/管线的职责）。
 */

import type {
  DayBar,
  LevelDifficulty,
  LevelIndex,
  LevelIndexEntry,
  LevelPack,
  MarketEvent,
  MarketEventType,
} from '../types/contract'

// ---- 静态注册表（自动生成）-----------------------------------------------
// index.json 与全部关卡文件在编译期静态引入。
// 下方 BEGIN..END 之间的内容由 `node tools/build-levels.mjs` 自动生成，请勿手改：
// 该脚本扫描 src/assets/levels/**/level_*.json，重建本注册表与 index.json。
// 新增关卡（含 generated_real/ 真实数据）后重跑该脚本即可。
import levelIndexJson from '../assets/levels/index.json'
// >>> LEVELS:GENERATED:BEGIN
import level_0001_json from '../assets/levels/level_0001.json'
import level_0002_json from '../assets/levels/level_0002.json'
import level_0003_json from '../assets/levels/level_0003.json'
import level_0004_json from '../assets/levels/level_0004.json'
import level_0005_json from '../assets/levels/level_0005.json'
import level_0006_json from '../assets/levels/level_0006.json'
import level_0007_json from '../assets/levels/level_0007.json'
import level_0008_json from '../assets/levels/level_0008.json'
import level_0009_json from '../assets/levels/level_0009.json'
import level_0010_json from '../assets/levels/level_0010.json'
import level_0011_json from '../assets/levels/level_0011.json'
import level_0012_json from '../assets/levels/level_0012.json'
import generated_real_level_b0001_json from '../assets/levels/generated_real/level_b0001.json'
import generated_real_level_b0002_json from '../assets/levels/generated_real/level_b0002.json'
import generated_real_level_b0003_json from '../assets/levels/generated_real/level_b0003.json'
import generated_real_level_b0004_json from '../assets/levels/generated_real/level_b0004.json'
import generated_real_level_b0005_json from '../assets/levels/generated_real/level_b0005.json'
import generated_real_level_b0006_json from '../assets/levels/generated_real/level_b0006.json'
import generated_real_level_b0007_json from '../assets/levels/generated_real/level_b0007.json'
import generated_real_level_b0008_json from '../assets/levels/generated_real/level_b0008.json'
import generated_real_level_b0009_json from '../assets/levels/generated_real/level_b0009.json'
import generated_real_level_b0010_json from '../assets/levels/generated_real/level_b0010.json'
import generated_real_level_b0011_json from '../assets/levels/generated_real/level_b0011.json'
import generated_real_level_b0012_json from '../assets/levels/generated_real/level_b0012.json'
import generated_real_level_b0013_json from '../assets/levels/generated_real/level_b0013.json'
import generated_real_level_b0014_json from '../assets/levels/generated_real/level_b0014.json'
import generated_real_level_b0015_json from '../assets/levels/generated_real/level_b0015.json'
import generated_real_level_b0016_json from '../assets/levels/generated_real/level_b0016.json'
import generated_real_level_b0017_json from '../assets/levels/generated_real/level_b0017.json'
import generated_real_level_b0018_json from '../assets/levels/generated_real/level_b0018.json'
import generated_real_level_b0019_json from '../assets/levels/generated_real/level_b0019.json'
import generated_real_level_b0020_json from '../assets/levels/generated_real/level_b0020.json'
import generated_real_level_b0021_json from '../assets/levels/generated_real/level_b0021.json'
import generated_real_level_b0022_json from '../assets/levels/generated_real/level_b0022.json'
import generated_real_level_b0023_json from '../assets/levels/generated_real/level_b0023.json'
import generated_real_level_b0024_json from '../assets/levels/generated_real/level_b0024.json'
import generated_real_level_b0025_json from '../assets/levels/generated_real/level_b0025.json'
import generated_real_level_d0001_json from '../assets/levels/generated_real/level_d0001.json'
import generated_real_level_d0002_json from '../assets/levels/generated_real/level_d0002.json'
import generated_real_level_d0003_json from '../assets/levels/generated_real/level_d0003.json'
import generated_real_level_d0004_json from '../assets/levels/generated_real/level_d0004.json'
import generated_real_level_d0005_json from '../assets/levels/generated_real/level_d0005.json'
import generated_real_level_d0006_json from '../assets/levels/generated_real/level_d0006.json'

/**
 * 关卡文件注册表：file 名 -> 原始 JSON 模块。
 * key 与 index.json 中每个条目的 `file` 字段一致。
 */
const LEVEL_MODULES: Record<string, unknown> = {
  'level_0001.json': level_0001_json,
  'level_0002.json': level_0002_json,
  'level_0003.json': level_0003_json,
  'level_0004.json': level_0004_json,
  'level_0005.json': level_0005_json,
  'level_0006.json': level_0006_json,
  'level_0007.json': level_0007_json,
  'level_0008.json': level_0008_json,
  'level_0009.json': level_0009_json,
  'level_0010.json': level_0010_json,
  'level_0011.json': level_0011_json,
  'level_0012.json': level_0012_json,
  'generated_real/level_b0001.json': generated_real_level_b0001_json,
  'generated_real/level_b0002.json': generated_real_level_b0002_json,
  'generated_real/level_b0003.json': generated_real_level_b0003_json,
  'generated_real/level_b0004.json': generated_real_level_b0004_json,
  'generated_real/level_b0005.json': generated_real_level_b0005_json,
  'generated_real/level_b0006.json': generated_real_level_b0006_json,
  'generated_real/level_b0007.json': generated_real_level_b0007_json,
  'generated_real/level_b0008.json': generated_real_level_b0008_json,
  'generated_real/level_b0009.json': generated_real_level_b0009_json,
  'generated_real/level_b0010.json': generated_real_level_b0010_json,
  'generated_real/level_b0011.json': generated_real_level_b0011_json,
  'generated_real/level_b0012.json': generated_real_level_b0012_json,
  'generated_real/level_b0013.json': generated_real_level_b0013_json,
  'generated_real/level_b0014.json': generated_real_level_b0014_json,
  'generated_real/level_b0015.json': generated_real_level_b0015_json,
  'generated_real/level_b0016.json': generated_real_level_b0016_json,
  'generated_real/level_b0017.json': generated_real_level_b0017_json,
  'generated_real/level_b0018.json': generated_real_level_b0018_json,
  'generated_real/level_b0019.json': generated_real_level_b0019_json,
  'generated_real/level_b0020.json': generated_real_level_b0020_json,
  'generated_real/level_b0021.json': generated_real_level_b0021_json,
  'generated_real/level_b0022.json': generated_real_level_b0022_json,
  'generated_real/level_b0023.json': generated_real_level_b0023_json,
  'generated_real/level_b0024.json': generated_real_level_b0024_json,
  'generated_real/level_b0025.json': generated_real_level_b0025_json,
  'generated_real/level_d0001.json': generated_real_level_d0001_json,
  'generated_real/level_d0002.json': generated_real_level_d0002_json,
  'generated_real/level_d0003.json': generated_real_level_d0003_json,
  'generated_real/level_d0004.json': generated_real_level_d0004_json,
  'generated_real/level_d0005.json': generated_real_level_d0005_json,
  'generated_real/level_d0006.json': generated_real_level_d0006_json,
}
// <<< LEVELS:GENERATED:END

// ---- 错误类型 ------------------------------------------------------------

/** 加载错误码，便于调用方区分处理（统一为「跳过换关」即可）。 */
export type LevelLoadErrorCode =
  | 'INDEX_INVALID' // index.json 结构非法
  | 'LEVEL_NOT_FOUND' // 按 levelId/file 找不到关卡
  | 'LEVEL_INVALID' // 关卡包结构 / 字段 / 不变量校验失败
  | 'NO_CANDIDATE' // 选关时过滤后无候选

/**
 * 可识别的关卡加载错误。调用方应 catch 此类错误并跳过/换关，而非崩溃。
 */
export class LevelLoadError extends Error {
  readonly code: LevelLoadErrorCode
  /** 出错关卡的标识（levelId 或 file），若适用。 */
  readonly levelRef?: string

  constructor(code: LevelLoadErrorCode, message: string, levelRef?: string) {
    super(message)
    this.name = 'LevelLoadError'
    this.code = code
    this.levelRef = levelRef
    // 维持原型链（TS 编译到 ES5 时的常见坑；此处目标 ES2017 一般无碍，保险起见保留）
    Object.setPrototypeOf(this, LevelLoadError.prototype)
  }
}

// ---- 随机源（可注入） ----------------------------------------------------

/** 随机数源：返回 [0, 1) 的浮点数。默认 Math.random，可注入以保证可测/可复现。 */
export type Rng = () => number

const defaultRng: Rng = () => Math.random()

// ---- 内部校验工具 --------------------------------------------------------

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function fail(code: LevelLoadErrorCode, message: string, ref?: string): never {
  throw new LevelLoadError(code, message, ref)
}

const VALID_DIFFICULTIES: ReadonlyArray<LevelDifficulty> = [
  'easy',
  'normal',
  'hard',
]
const VALID_EVENT_TYPES: ReadonlyArray<MarketEventType> = [
  'halt',
  'st',
  'delist',
]

/**
 * 校验并归一化 index.json，返回类型安全的 LevelIndex。
 * 非法时抛 LevelLoadError('INDEX_INVALID')。
 */
function validateIndex(raw: unknown): LevelIndex {
  if (typeof raw !== 'object' || raw === null) {
    fail('INDEX_INVALID', 'index.json 不是对象')
  }
  const levels = (raw as { levels?: unknown }).levels
  if (!Array.isArray(levels)) {
    fail('INDEX_INVALID', 'index.json.levels 不是数组')
  }
  if (levels.length === 0) {
    fail('INDEX_INVALID', 'index.json.levels 为空')
  }

  const entries: LevelIndexEntry[] = levels.map((item, i) => {
    if (typeof item !== 'object' || item === null) {
      fail('INDEX_INVALID', `index.levels[${i}] 不是对象`)
    }
    const e = item as Record<string, unknown>
    if (typeof e.levelId !== 'string' || e.levelId.length === 0) {
      fail('INDEX_INVALID', `index.levels[${i}].levelId 缺失`)
    }
    if (typeof e.file !== 'string' || e.file.length === 0) {
      fail('INDEX_INVALID', `index.levels[${i}].file 缺失`, e.levelId as string)
    }
    if (!VALID_DIFFICULTIES.includes(e.difficulty as LevelDifficulty)) {
      fail(
        'INDEX_INVALID',
        `index.levels[${i}].difficulty 非法: ${String(e.difficulty)}`,
        e.levelId as string,
      )
    }
    if (
      !Array.isArray(e.outcomeTags) ||
      !e.outcomeTags.every((t) => typeof t === 'string')
    ) {
      fail(
        'INDEX_INVALID',
        `index.levels[${i}].outcomeTags 非法`,
        e.levelId as string,
      )
    }
    if (!isFiniteNumber(e.totalDays)) {
      fail(
        'INDEX_INVALID',
        `index.levels[${i}].totalDays 非法`,
        e.levelId as string,
      )
    }
    return {
      levelId: e.levelId as string,
      difficulty: e.difficulty as LevelDifficulty,
      outcomeTags: (e.outcomeTags as string[]).slice(),
      totalDays: e.totalDays as number,
      file: e.file as string,
    }
  })

  return { levels: entries }
}

/**
 * 校验单个 DayBar 的关键字段与不变量。
 * 抛错信息会带上 day 序号，便于定位。
 */
function validateDayBar(raw: unknown, idx: number, levelId: string): DayBar {
  if (typeof raw !== 'object' || raw === null) {
    fail('LEVEL_INVALID', `days[${idx}] 不是对象`, levelId)
  }
  const d = raw as Record<string, unknown>

  const requiredNums: Array<keyof DayBar> = [
    'day',
    'open',
    'high',
    'low',
    'close',
    'volume',
  ]
  for (const key of requiredNums) {
    if (!isFiniteNumber(d[key])) {
      fail('LEVEL_INVALID', `days[${idx}].${String(key)} 非有限数字`, levelId)
    }
  }
  if (typeof d.tradable !== 'boolean') {
    fail('LEVEL_INVALID', `days[${idx}].tradable 缺失或非布尔`, levelId)
  }

  const open = d.open as number
  const high = d.high as number
  const low = d.low as number
  const close = d.close as number

  // 基本价格不变量：low <= open/close <= high
  if (low > high || open < low || open > high || close < low || close > high) {
    fail(
      'LEVEL_INVALID',
      `days[${idx}] 价格不变量失败 (low=${low},open=${open},close=${close},high=${high})`,
      levelId,
    )
  }
  if ((d.volume as number) < 0) {
    fail('LEVEL_INVALID', `days[${idx}].volume 为负`, levelId)
  }

  // priceLimit：允许 null / undefined / 正数
  if (
    d.priceLimit !== undefined &&
    d.priceLimit !== null &&
    !(isFiniteNumber(d.priceLimit) && (d.priceLimit as number) > 0)
  ) {
    fail('LEVEL_INVALID', `days[${idx}].priceLimit 非法`, levelId)
  }

  // 可选数值指标：若存在必须是有限数字
  const optionalNums: Array<keyof DayBar> = [
    'turnover',
    'volumeRatio',
    'ma5',
    'ma10',
    'ma20',
    'macd',
    'dif',
    'dea',
    'rsi',
  ]
  for (const key of optionalNums) {
    if (d[key] !== undefined && !isFiniteNumber(d[key])) {
      fail('LEVEL_INVALID', `days[${idx}].${String(key)} 存在但非有限数字`, levelId)
    }
  }

  // 直接返回原对象（已是结构合法的 DayBar）；保留未知字段无害。
  return raw as DayBar
}

function validateEvent(raw: unknown, idx: number, levelId: string): MarketEvent {
  if (typeof raw !== 'object' || raw === null) {
    fail('LEVEL_INVALID', `events[${idx}] 不是对象`, levelId)
  }
  const ev = raw as Record<string, unknown>
  if (!VALID_EVENT_TYPES.includes(ev.type as MarketEventType)) {
    fail('LEVEL_INVALID', `events[${idx}].type 非法: ${String(ev.type)}`, levelId)
  }
  if (!isFiniteNumber(ev.startDay)) {
    fail('LEVEL_INVALID', `events[${idx}].startDay 非法`, levelId)
  }
  for (const key of ['endDay', 'resumeDay'] as const) {
    if (ev[key] !== undefined && !isFiniteNumber(ev[key])) {
      fail('LEVEL_INVALID', `events[${idx}].${key} 存在但非法`, levelId)
    }
  }
  return raw as MarketEvent
}

/**
 * 校验并归一化关卡包。校验失败抛 LevelLoadError('LEVEL_INVALID')。
 * @param entry 可选：对应的索引条目，用于交叉校验 levelId / totalDays。
 */
function validateLevelPack(raw: unknown, entry?: LevelIndexEntry): LevelPack {
  const ref = entry?.levelId
  if (typeof raw !== 'object' || raw === null) {
    fail('LEVEL_INVALID', '关卡包不是对象', ref)
  }
  const p = raw as Record<string, unknown>

  if (typeof p.levelId !== 'string' || p.levelId.length === 0) {
    fail('LEVEL_INVALID', '关卡包 levelId 缺失', ref)
  }
  const levelId = p.levelId as string

  for (const key of ['totalDays', 'revealDays', 'startCash'] as const) {
    if (!isFiniteNumber(p[key])) {
      fail('LEVEL_INVALID', `关卡包 ${key} 非法`, levelId)
    }
  }
  const totalDays = p.totalDays as number

  if (!Array.isArray(p.days)) {
    fail('LEVEL_INVALID', '关卡包 days 不是数组', levelId)
  }
  if (p.days.length !== totalDays) {
    fail(
      'LEVEL_INVALID',
      `days 长度(${p.days.length}) != totalDays(${totalDays})`,
      levelId,
    )
  }

  const days = p.days.map((d, i) => validateDayBar(d, i, levelId))

  // day 序号应从 0 起且连续递增
  for (let i = 0; i < days.length; i++) {
    if (days[i].day !== i) {
      fail('LEVEL_INVALID', `days[${i}].day 非连续 (期望 ${i}, 实得 ${days[i].day})`, levelId)
    }
  }

  if (!Array.isArray(p.events)) {
    fail('LEVEL_INVALID', '关卡包 events 不是数组', levelId)
  }
  const events = p.events.map((e, i) => validateEvent(e, i, levelId))

  if (typeof p.reveal !== 'object' || p.reveal === null) {
    fail('LEVEL_INVALID', '关卡包 reveal 缺失', levelId)
  }
  const reveal = p.reveal as Record<string, unknown>
  if (
    !Array.isArray(reveal.outcomeTags) ||
    !reveal.outcomeTags.every((t) => typeof t === 'string')
  ) {
    fail('LEVEL_INVALID', 'reveal.outcomeTags 非法', levelId)
  }
  if (typeof reveal.story !== 'string') {
    fail('LEVEL_INVALID', 'reveal.story 缺失或非字符串', levelId)
  }

  // 与索引条目交叉校验（若提供）
  if (entry) {
    if (entry.levelId !== levelId) {
      fail(
        'LEVEL_INVALID',
        `levelId 与索引不一致 (索引=${entry.levelId}, 包=${levelId})`,
        levelId,
      )
    }
    if (entry.totalDays !== totalDays) {
      fail(
        'LEVEL_INVALID',
        `totalDays 与索引不一致 (索引=${entry.totalDays}, 包=${totalDays})`,
        levelId,
      )
    }
  }

  return {
    levelId,
    totalDays,
    revealDays: p.revealDays as number,
    startCash: p.startCash as number,
    days,
    events,
    reveal: {
      outcomeTags: (reveal.outcomeTags as string[]).slice(),
      story: reveal.story as string,
    },
  }
}

// ---- 公共 API ------------------------------------------------------------

/**
 * 加载并校验关卡索引（index.json）。
 * @throws LevelLoadError('INDEX_INVALID') 索引结构非法
 */
export async function loadIndex(): Promise<LevelIndex> {
  return validateIndex(levelIndexJson)
}

/**
 * 按 levelId 或 file 名加载单个关卡包。
 *
 * @param ref 关卡标识：可为 levelId（如 'level_0001'）或 file 名（如 'level_0001.json'）。
 * @throws LevelLoadError('LEVEL_NOT_FOUND') 找不到对应关卡
 * @throws LevelLoadError('LEVEL_INVALID')  关卡包结构 / 字段 / 不变量校验失败
 */
export async function loadLevel(ref: string): Promise<LevelPack> {
  const index = await loadIndex()

  // 解析 ref -> 索引条目（兼容传 levelId 或 file）
  const entry = index.levels.find(
    (e) => e.levelId === ref || e.file === ref,
  )

  // 解析 file 名：优先用索引条目的 file，否则把 ref 当作 file（兼容直接传文件名）
  const file = entry?.file ?? (ref.endsWith('.json') ? ref : `${ref}.json`)

  const mod = LEVEL_MODULES[file]
  if (mod === undefined) {
    fail('LEVEL_NOT_FOUND', `未找到关卡资源: ${ref} (file=${file})`, ref)
  }

  return validateLevelPack(mod, entry)
}

/** pickRandomLevel 的过滤 / 随机选项。 */
export interface PickLevelOptions {
  /** 仅在这些难度中选。 */
  difficulty?: LevelDifficulty | LevelDifficulty[]
  /** 要求 outcomeTags 至少包含其中之一（任意命中即可）。 */
  outcomeTags?: string[]
  /** 排除这些 levelId（如已玩过的关卡）。 */
  excludeLevelIds?: string[]
  /** 可注入的随机源，默认 Math.random。 */
  rng?: Rng
}

/**
 * 从索引中按策略随机挑选一个关卡条目（不加载关卡文件本身）。
 *
 * 纯函数（除注入的 rng 外无副作用），不在模块顶层执行；调用方拿到 entry 后再 loadLevel。
 *
 * @throws LevelLoadError('NO_CANDIDATE') 过滤后无候选关卡
 */
export function pickRandomLevel(
  index: LevelIndex,
  opts: PickLevelOptions = {},
): LevelIndexEntry {
  const rng = opts.rng ?? defaultRng

  const difficulties =
    opts.difficulty === undefined
      ? undefined
      : Array.isArray(opts.difficulty)
        ? opts.difficulty
        : [opts.difficulty]

  const wantTags = opts.outcomeTags
  const exclude = new Set(opts.excludeLevelIds ?? [])

  const candidates = index.levels.filter((e) => {
    if (exclude.has(e.levelId)) return false
    if (difficulties && !difficulties.includes(e.difficulty)) return false
    if (wantTags && wantTags.length > 0) {
      const hit = e.outcomeTags.some((t) => wantTags.includes(t))
      if (!hit) return false
    }
    return true
  })

  if (candidates.length === 0) {
    fail('NO_CANDIDATE', '过滤条件下无可选关卡')
  }

  const i = Math.floor(rng() * candidates.length)
  // 防御 rng 返回 1 或越界
  const safeIndex = Math.min(Math.max(i, 0), candidates.length - 1)
  return candidates[safeIndex]
}

/**
 * 便捷方法：随机选一关并直接加载其关卡包。
 *
 * 健壮性：若选中的关卡校验失败 (LEVEL_INVALID / NOT_FOUND)，自动把它加入排除名单并换关重试，
 * 直到成功或候选耗尽（耗尽时抛最后一次的错误）。符合设计文档 §7「损坏则跳过换关」。
 */
export async function loadRandomLevel(
  opts: PickLevelOptions = {},
): Promise<{ entry: LevelIndexEntry; level: LevelPack }> {
  const index = await loadIndex()
  const excludeLevelIds = [...(opts.excludeLevelIds ?? [])]
  let lastError: unknown

  // 最多尝试 = 关卡总数 次
  for (let attempt = 0; attempt < index.levels.length; attempt++) {
    let entry: LevelIndexEntry
    try {
      entry = pickRandomLevel(index, { ...opts, excludeLevelIds })
    } catch (err) {
      // NO_CANDIDATE：候选耗尽
      throw lastError ?? err
    }
    try {
      const level = await loadLevel(entry.file)
      return { entry, level }
    } catch (err) {
      lastError = err
      excludeLevelIds.push(entry.levelId)
    }
  }

  throw (
    lastError ??
    new LevelLoadError('NO_CANDIDATE', '无可成功加载的关卡')
  )
}
