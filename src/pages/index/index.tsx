/**
 * 页面入口（集成层装配）。
 *
 * 把 store(useGame) + Chart + TradePanel + Result 组合成一局可玩的游戏：
 *   开始游戏 → 看前 10 日 K 线 → 逐日决策（加仓 / 卖出 / 持有 / 下一日）→ 结束后复盘 → 再来一局。
 *
 * 数据流：
 *   useGame 内部 [data loader] 加载关卡 → [engine] createInitialState/applyAction/settle 维护状态
 *     → 暴露 view（已揭示 days、当日价、涨跌幅、跳复牌可见性、是否结束）+ result
 *   本页面把 view 派生值喂给纯展示组件 Chart / TradePanel，把用户操作经 dispatch 回灌引擎。
 *
 * 布局：移动优先，单列纵向滚动；上为 K 线图，下为交易面板；结束后整页替换为 Result 复盘。
 */
import { useEffect, useRef } from 'react'
import { View, Text, Button, ScrollView } from '@tarojs/components'
import Chart from '../../components/Chart'
import TradePanel from '../../components/TradePanel'
import Result from '../../components/Result'
import StartScreen from '../../components/StartScreen'
import { useGame, useStats } from '../../store'
import './index.css'

export default function Index() {
  const { phase, error, level, state, view, result, dispatch, start, restart } =
    useGame()
  const { stats, record } = useStats()

  // 结算时记一局战绩（本地持久化，不进引擎）。每局仅记一次：以 level+finalAssets 为去重键。
  const recordedKeyRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!view?.finished || !result || !level) return
    const key = `${level.levelId}:${result.finalAssets}`
    if (recordedKeyRef.current === key) return
    recordedKeyRef.current = key
    record(result.roi)
  }, [view?.finished, result, level, record])

  // 起始页：等玩家点「开始挑战」才抽关
  if (phase === 'home') {
    return <StartScreen stats={stats} onStart={start} />
  }

  // 加载中
  if (phase === 'loading') {
    return (
      <View className="index-page index-page--center">
        <Text className="index-page__title">匿名股神</Text>
        <Text className="index-page__hint">正在发牌……</Text>
      </View>
    )
  }

  // 加载失败
  if (phase === 'error' || !level || !state || !view) {
    return (
      <View className="index-page index-page--center">
        <Text className="index-page__title">发牌失败</Text>
        <Text className="index-page__hint">{error ?? '关卡加载异常'}</Text>
        <Button className="index-page__retry" onClick={restart}>
          重试 / 换关
        </Button>
      </View>
    )
  }

  // 已结束 → 复盘
  if (view.finished && result) {
    return (
      <ScrollView scrollY className="index-page index-page--result">
        <Result
          result={result}
          events={level.events}
          history={state.history}
          startCash={level.startCash}
          onRestart={restart}
        />
      </ScrollView>
    )
  }

  // 进行中 → K 线 + 交易面板
  return (
    <ScrollView scrollY className="index-page index-page--play">
      <View className="index-page__chart">
        <Chart days={view.revealedDays} height={360} />
      </View>
      <View className="index-page__panel">
        <TradePanel
          cash={state.cash}
          shares={state.shares}
          price={view.price}
          tradable={view.tradable}
          changePct={view.changePct}
          daysLeft={view.daysLeft}
          totalDays={view.totalDays}
          skipToResumeVisible={view.skipToResumeVisible}
          finished={view.finished}
          onBuy={(cashRatio) => dispatch({ type: 'buy', cashRatio })}
          onSell={(shareRatio) => dispatch({ type: 'sell', shareRatio })}
          onHold={() => dispatch({ type: 'advance' })}
          onAdvance={() => dispatch({ type: 'advance' })}
          onSkipToResume={() => dispatch({ type: 'skipToResume' })}
        />
      </View>
    </ScrollView>
  )
}
