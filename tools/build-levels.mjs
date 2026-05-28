// Rebuild the merged level index.json AND the static registry block in
// src/data/levelLoader.ts from every level pack on disk (synthetic seeds +
// real data under generated_real/). Idempotent: safe to re-run after adding levels.
//
//   node tools/build-levels.mjs
//
// Difficulty is derived deterministically from outcomeTags so synthetic and
// real levels are graded consistently.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(__dirname, '..')
const LEVELS_DIR = path.join(REPO, 'src/assets/levels')
const LOADER = path.join(REPO, 'src/data/levelLoader.ts')

// Subdirs (relative to LEVELS_DIR) to scan in addition to the root. Add new
// real-data batches here.
const SUBDIRS = ['', 'generated_real']

const BEGIN = '// >>> LEVELS:GENERATED:BEGIN'
const END = '// <<< LEVELS:GENERATED:END'

const deriveDifficulty = (tags) => {
  const t = new Set(tags)
  if (t.has('delist') || t.has('long-halt')) return 'hard'
  if (t.has('crash') || t.has('st') || t.has('normal-halt')) return 'normal'
  return 'easy' // surge / flat
}

const identOf = (file) => file.replace(/[^a-zA-Z0-9]/g, '_')

function collect() {
  const entries = []
  for (const sub of SUBDIRS) {
    const dir = path.join(LEVELS_DIR, sub)
    let names
    try {
      names = readdirSync(dir)
    } catch {
      continue
    }
    const files = names
      .filter((n) => /^level_.*\.json$/.test(n))
      .sort()
    for (const name of files) {
      const rel = sub ? `${sub}/${name}` : name
      const pack = JSON.parse(readFileSync(path.join(dir, name), 'utf-8'))
      const tags = pack.reveal?.outcomeTags ?? []
      entries.push({
        levelId: pack.levelId,
        difficulty: deriveDifficulty(tags),
        outcomeTags: tags,
        totalDays: pack.totalDays,
        file: rel,
      })
    }
  }
  // stable: synthetic root levels first (SUBDIRS order), then generated_real
  return entries
}

function writeIndex(entries) {
  const index = { levels: entries }
  writeFileSync(
    path.join(LEVELS_DIR, 'index.json'),
    JSON.stringify(index, null, 2) + '\n',
  )
}

function writeRegistry(entries) {
  const imports = entries
    .map((e) => `import ${identOf(e.file)} from '../assets/levels/${e.file}'`)
    .join('\n')
  const regLines = entries
    .map((e) => `  '${e.file}': ${identOf(e.file)},`)
    .join('\n')
  const block = `${BEGIN}
${imports}

/**
 * 关卡文件注册表：file 名 -> 原始 JSON 模块。
 * key 与 index.json 中每个条目的 \`file\` 字段一致。
 */
const LEVEL_MODULES: Record<string, unknown> = {
${regLines}
}
${END}`

  const src = readFileSync(LOADER, 'utf-8')
  const start = src.indexOf(BEGIN)
  const stop = src.indexOf(END)
  if (start === -1 || stop === -1) {
    throw new Error('levelLoader.ts 未找到 LEVELS:GENERATED 标记')
  }
  const next = src.slice(0, start) + block + src.slice(stop + END.length)
  writeFileSync(LOADER, next)
}

const entries = collect()
writeIndex(entries)
writeRegistry(entries)

const byDiff = entries.reduce((m, e) => ((m[e.difficulty] = (m[e.difficulty] || 0) + 1), m), {})
const byTag = entries.reduce((m, e) => (e.outcomeTags.forEach((t) => (m[t] = (m[t] || 0) + 1)), m), {})
console.log(`[build-levels] ${entries.length} 关卡`)
console.log('  难度分布:', JSON.stringify(byDiff))
console.log('  结局分布:', JSON.stringify(byTag))
