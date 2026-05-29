/**
 * 起始页 / 欢迎页（纯展示 + 回调，Taro + React，H5 可用）。
 *
 * 职责：
 * - 品牌焦点：标题「匿名股神」+ slogan + K 线背景装饰。
 * - 唯一主 CTA「开始挑战」(onStart 回调)，发光呼吸。
 * - 新手引导：横排三步(看盘/决策/揭盘) + 「查看完整玩法 ›」展开底部 sheet（渐进披露）。
 * - 最佳记录区：最佳收益率 / 玩过局数 / 胜率（来自 props.stats，本地持久化）。
 *
 * 设计铁律：
 * - 红涨绿跌：最佳收益正=--up 负=--down；CTA 用中性蓝 --accent（红专留行情）。
 * - 不使用 ::before/::after/:nth-child；细线 / 光环用元素自身 box-shadow 或真实 View 叠层。
 * - 本组件零业务逻辑：状态由父级传入，操作经回调上抛。
 */
import { useState } from 'react'
import { View, Text } from '@tarojs/components'
import type { Stats } from '../../store'
import './index.css'

export interface StartScreenProps {
  /** 累计战绩（来自 useStats）。缺省按首玩空态展示。 */
  stats?: Stats
  /** 点击「开始挑战」回调。 */
  onStart: () => void
}

/** 起始页 K 线背景：~10 根红绿交替蜡烛（实体 + 影线），向右上倾斜隐喻拉升。 */
const CANDLES = [
  { up: true, h: 34, wick: 56, top: 58 },
  { up: false, h: 22, wick: 40, top: 50 },
  { up: true, h: 44, wick: 70, top: 44 },
  { up: true, h: 30, wick: 50, top: 40 },
  { up: false, h: 26, wick: 44, top: 34 },
  { up: true, h: 50, wick: 76, top: 26 },
  { up: false, h: 20, wick: 36, top: 24 },
  { up: true, h: 56, wick: 82, top: 14 },
  { up: true, h: 38, wick: 60, top: 12 },
  { up: false, h: 28, wick: 46, top: 6 },
]

/** 把收益率小数格式化为带符号百分比，如 0.247 → "+24.7%"。 */
function fmtRoi(roi: number): string {
  const sign = roi > 0 ? '+' : ''
  return `${sign}${(roi * 100).toFixed(1)}%`
}

export default function StartScreen({ stats, onStart }: StartScreenProps) {
  const [sheetOpen, setSheetOpen] = useState(false)

  const played = stats?.gamesPlayed ?? 0
  const hasBest = stats?.bestRoi !== undefined
  const bestRoi = stats?.bestRoi ?? 0
  const winRate = played > 0 ? Math.round(((stats?.wins ?? 0) / played) * 100) : 0

  const bestClass = bestRoi >= 0 ? 'home__rec-val--up' : 'home__rec-val--down'

  return (
    <View className="home">
      {/* K 线背景装饰（铺底、不可点） */}
      <View className="home__bg">
        <View className="home__grid" />
        <View className="home__candles">
          {CANDLES.map((c, i) => (
            <View className="home__candle-col" key={i}>
              <View
                className={`home__wick ${c.up ? 'home__wick--up' : 'home__wick--down'}`}
                style={{ height: `${c.wick}%`, marginTop: `${c.top}%` }}
              />
              <View
                className={`home__body ${c.up ? 'home__body--up' : 'home__body--down'}`}
                style={{ height: `${c.h}%` }}
              />
            </View>
          ))}
        </View>
        <View className="home__bg-mask" />
      </View>

      {/* 内容层 */}
      <View className="home__content">
        {/* 品牌 */}
        <View className="home__brand">
          <Text className="home__title">匿名股神</Text>
          <View className="home__title-bar" />
          <Text className="home__slogan">只看前十日，赌出你的封神局</Text>
        </View>

        {/* 最佳战绩 */}
        <View className="home__record">
          <View className="home__rec-cell">
            <Text className="home__rec-label">最佳收益</Text>
            <Text className={`home__rec-val num ${hasBest ? bestClass : 'home__rec-val--empty'}`}>
              {hasBest ? fmtRoi(bestRoi) : '--'}
            </Text>
          </View>
          <View className="home__rec-cell home__rec-cell--mid">
            <Text className="home__rec-label">局数</Text>
            <Text className="home__rec-val num">{played}</Text>
          </View>
          <View className="home__rec-cell">
            <Text className="home__rec-label">胜率</Text>
            <Text className={`home__rec-val num ${played > 0 ? 'home__rec-val--rate' : 'home__rec-val--empty'}`}>
              {played > 0 ? `${winRate}%` : '--'}
            </Text>
          </View>
        </View>

        {/* 新手引导：横排三步 */}
        <View className="home__steps">
          <View className="home__step">
            <Text className="home__step-icon">📈</Text>
            <Text className="home__step-title">看盘</Text>
            <Text className="home__step-desc">前 10 天 K 线</Text>
          </View>
          <View className="home__step">
            <Text className="home__step-icon">🎯</Text>
            <Text className="home__step-title">决策</Text>
            <Text className="home__step-desc">逐日买卖</Text>
          </View>
          <View className="home__step">
            <Text className="home__step-icon">🃏</Text>
            <Text className="home__step-title">揭盘</Text>
            <Text className="home__step-desc home__step-desc--warn">真相 · 归零</Text>
          </View>
        </View>

        {/* 主 CTA + 玩法链接 */}
        <View className="home__footer">
          <View className="home__cta" onClick={onStart}>
            <Text className="home__cta-text">▶  开始挑战</Text>
          </View>
          <Text className="home__more" onClick={() => setSheetOpen(true)}>
            查看完整玩法 ›
          </Text>

          {/* 教育意图：玩前点题——仅凭 K 线交易长期难赢。 */}
          <View className="home__edu">
            <Text className="home__edu-lead">只看 K 线，赢的是运气，输的是趋势</Text>
            <Text className="home__edu-body">
              脱离基本面、只盯图形猜涨跌，长期大概率是亏的。本游戏就想让你亲手体验这一点——看清它，比赢这一局更值钱。
            </Text>
          </View>
        </View>
      </View>

      {/* 玩法说明底部 sheet（渐进披露） */}
      {sheetOpen && (
        <View className="home__overlay" onClick={() => setSheetOpen(false)}>
          <View
            className="home__sheet"
            onClick={(e) => {
              // 阻止冒泡，点 sheet 内部不关闭
              e.stopPropagation?.()
            }}
          >
            <View className="home__sheet-head">
              <Text className="home__sheet-title">玩法说明</Text>
              <Text className="home__sheet-close" onClick={() => setSheetOpen(false)}>
                ✕
              </Text>
            </View>
            <View className="home__rule">
              <Text className="home__rule-no">1</Text>
              <Text className="home__rule-text">
                开局只给你看前 10 天 K 线，其余未来全是未知。
              </Text>
            </View>
            <View className="home__rule">
              <Text className="home__rule-no">2</Text>
              <Text className="home__rule-text">
                之后逐日决策：加仓 / 卖出 / 持有，价随行情逐日揭示。
              </Text>
            </View>
            <View className="home__rule">
              <Text className="home__rule-no">3</Text>
              <Text className="home__rule-text">
                小心停牌 · ST · 退市 ——
                <Text className="home__rule-warn"> 踩雷可能归零！</Text>
              </Text>
            </View>
            <View className="home__sheet-btn" onClick={() => setSheetOpen(false)}>
              <Text className="home__sheet-btn-text">我知道了</Text>
            </View>
          </View>
        </View>
      )}
    </View>
  )
}
