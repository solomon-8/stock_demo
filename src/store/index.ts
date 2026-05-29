/**
 * 游戏状态 hook（集成层）—— 对外入口（barrel）。
 *
 * 装配 src/engine（纯函数状态机）与 src/data（关卡加载器），对外暴露 React hook。
 */

export { useGame, default } from './useGame'
export type {
  UseGameResult,
  GameView,
  LoadPhase,
} from './useGame'

export { useStats, mergeResult, STATS_KEY } from './useStats'
export type { Stats, UseStatsResult } from './useStats'
