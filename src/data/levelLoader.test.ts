import { describe, it, expect } from 'vitest'
import {
  loadIndex,
  loadLevel,
  pickRandomLevel,
  loadRandomLevel,
  LevelLoadError,
} from './levelLoader'

describe('loadIndex', () => {
  it('加载并校验 index.json', async () => {
    const index = await loadIndex()
    expect(index.levels.length).toBeGreaterThan(0)
    for (const e of index.levels) {
      expect(typeof e.levelId).toBe('string')
      expect(e.file).toMatch(/\.json$/)
      expect(['easy', 'normal', 'hard']).toContain(e.difficulty)
    }
  })
})

describe('loadLevel', () => {
  it('按 levelId 加载并通过不变量校验', async () => {
    const level = await loadLevel('level_0001')
    expect(level.levelId).toBe('level_0001')
    expect(level.days.length).toBe(level.totalDays)
    expect(level.revealDays).toBe(10)
    expect(level.startCash).toBe(100000)
    // day 连续
    level.days.forEach((d, i) => expect(d.day).toBe(i))
  })

  it('按 file 名加载', async () => {
    const level = await loadLevel('level_0002.json')
    expect(level.levelId).toBe('level_0002')
  })

  it('找不到关卡抛 LEVEL_NOT_FOUND', async () => {
    await expect(loadLevel('does_not_exist')).rejects.toMatchObject({
      code: 'LEVEL_NOT_FOUND',
    })
  })

  it('所有关卡均可成功加载并校验', async () => {
    const index = await loadIndex()
    for (const e of index.levels) {
      const level = await loadLevel(e.file)
      expect(level.levelId).toBe(e.levelId)
      expect(level.totalDays).toBe(e.totalDays)
    }
  })
})

describe('pickRandomLevel', () => {
  it('注入 rng 可复现选择', async () => {
    const index = await loadIndex()
    const e1 = pickRandomLevel(index, { rng: () => 0 })
    expect(e1).toEqual(index.levels[0])
    const eLast = pickRandomLevel(index, { rng: () => 0.999999 })
    expect(eLast).toEqual(index.levels[index.levels.length - 1])
  })

  it('按 difficulty 过滤', async () => {
    const index = await loadIndex()
    const e = pickRandomLevel(index, { difficulty: 'hard', rng: () => 0 })
    expect(e.difficulty).toBe('hard')
  })

  it('按 outcomeTags 过滤（任意命中）', async () => {
    const index = await loadIndex()
    const e = pickRandomLevel(index, { outcomeTags: ['surge'], rng: () => 0 })
    expect(e.outcomeTags).toContain('surge')
  })

  it('excludeLevelIds 排除指定关卡', async () => {
    const index = await loadIndex()
    const all = index.levels.map((l) => l.levelId)
    const exclude = all.slice(0, all.length - 1)
    const e = pickRandomLevel(index, { excludeLevelIds: exclude, rng: () => 0 })
    expect(e.levelId).toBe(all[all.length - 1])
  })

  it('无候选时抛 NO_CANDIDATE', async () => {
    const index = await loadIndex()
    expect(() =>
      pickRandomLevel(index, { difficulty: 'easy', outcomeTags: ['__none__'] }),
    ).toThrow(LevelLoadError)
  })
})

describe('loadRandomLevel', () => {
  it('随机选并加载一关', async () => {
    const { entry, level } = await loadRandomLevel({ rng: () => 0 })
    expect(entry.levelId).toBe(level.levelId)
  })
})
