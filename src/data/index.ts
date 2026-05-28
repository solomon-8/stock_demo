/**
 * 关卡加载器 —— 对外入口（barrel）。
 *
 * 真实实现见 ./levelLoader。本文件统一导出公共 API，并为早期占位命名提供兼容别名，
 * 使任何按旧签名（loadLevelIndex / pickRandomLevelId）编写的集成层仍可工作。
 */

import type { LevelIndex } from '../types/contract'
import { loadIndex, pickRandomLevel } from './levelLoader'

export {
  loadIndex,
  loadLevel,
  pickRandomLevel,
  loadRandomLevel,
  LevelLoadError,
} from './levelLoader'
export type {
  Rng,
  LevelLoadErrorCode,
  PickLevelOptions,
} from './levelLoader'

// ---- 兼容别名（占位文件的旧命名） ---------------------------------------

/** @deprecated 使用 loadIndex 代替。 */
export const loadLevelIndex = loadIndex

/**
 * @deprecated 使用 pickRandomLevel(index, opts).levelId 代替。
 * 保留旧签名：返回 levelId 字符串。
 */
export function pickRandomLevelId(index: LevelIndex): string {
  return pickRandomLevel(index).levelId
}
