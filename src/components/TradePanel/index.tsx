/**
 * 交易面板组件（纯展示 + 回调）。
 *
 * 设计原则：本组件零业务逻辑，所有数值由上层（集成层 / store）从 GameState 与当前 DayBar 派生后通过
 * props 传入，所有用户操作以回调形式抛回上层（由 engine.applyAction 处理）。
 * 仅使用 Taro 组件（View/Text/Slider/Button），保证 H5 可用且未来可移植小程序。
 *
 * 交互规则（UI 层）：
 * - 买入按现金百分比（含 25/50/75/100 快捷档），卖出按持仓百分比。
 * - 停牌时（tradable=false）禁用买/卖按钮与滑条，价格冻结仅展示。
 * - "跳到复牌首日"按钮仅在 skipToResumeVisible=true（超长停牌）时出现。
 * - 退市 / 结束（finished）时禁用全部交易操作。
 */
import { useState } from 'react'
import { View, Text, Slider, Button } from '@tarojs/components'
import './index.css'

export interface TradePanelProps {
  /** 当前现金（虚拟币） */
  cash: number
  /** 当前持股数（整数股） */
  shares: number
  /** 当日价（成交参考价：收盘价，或复牌后开盘价） */
  price: number
  /** 当日是否可交易；停牌为 false（禁用买/卖） */
  tradable: boolean
  /** 当日涨跌幅（小数，如 0.03 表示 +3%）。用于展示，可选 */
  changePct?: number
  /** 剩余交易日数（含当日，用于展示进度） */
  daysLeft: number
  /** 本局总交易日数（用于展示进度，可选） */
  totalDays?: number
  /** 是否显示"跳到复牌首日"按钮（仅超长停牌时为 true） */
  skipToResumeVisible: boolean
  /** 是否已结束（退市 / 局终）；为 true 时禁用全部交易操作 */
  finished?: boolean

  /** 买入回调：cashRatio 为买入金额占当前现金的比例，0~1 */
  onBuy: (cashRatio: number) => void
  /** 卖出回调：shareRatio 为卖出数量占当前持仓的比例，0~1 */
  onSell: (shareRatio: number) => void
  /** 持有回调（不交易，推进一日由上层决定是否合并） */
  onHold: () => void
  /** 推进一日回调（揭示下一交易日） */
  onAdvance: () => void
  /** 跳到复牌首日回调（仅超长停牌时可用） */
  onSkipToResume: () => void
}

/** 快捷档百分比（用于买入按现金% / 卖出按持仓%） */
const QUICK_RATIOS = [25, 50, 75, 100] as const

function formatMoney(n: number): string {
  return n.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function formatPct(p: number): string {
  const sign = p > 0 ? '+' : ''
  return `${sign}${(p * 100).toFixed(2)}%`
}

export default function TradePanel(props: TradePanelProps) {
  const {
    cash,
    shares,
    price,
    tradable,
    changePct,
    daysLeft,
    totalDays,
    skipToResumeVisible,
    finished = false,
    onBuy,
    onSell,
    onHold,
    onAdvance,
    onSkipToResume,
  } = props

  // 滑条百分比为本组件内部 UI 状态（0~100），下沉为比例后再回调，不持有业务状态。
  const [buyPct, setBuyPct] = useState(50)
  const [sellPct, setSellPct] = useState(50)

  // 派生展示值（纯计算，不可变）
  const positionValue = shares * price
  const totalAssets = cash + positionValue
  const changeClass =
    changePct === undefined
      ? 'trade-panel__delta'
      : changePct > 0
        ? 'trade-panel__delta trade-panel__delta--up'
        : changePct < 0
          ? 'trade-panel__delta trade-panel__delta--down'
          : 'trade-panel__delta'

  // 是否禁用交易操作：停牌、已结束。
  const tradingDisabled = !tradable || finished
  const canBuy = tradingDisabled ? false : cash > 0
  const canSell = tradingDisabled ? false : shares > 0

  return (
    <View className="trade-panel">
      {/* 资产概览 */}
      <View className="trade-panel__summary">
        <View className="trade-panel__summary-row">
          <Text className="trade-panel__label">现金</Text>
          <Text className="trade-panel__value">{formatMoney(cash)}</Text>
        </View>
        <View className="trade-panel__summary-row">
          <Text className="trade-panel__label">持仓市值</Text>
          <Text className="trade-panel__value">
            {formatMoney(positionValue)}
            <Text className="trade-panel__sub"> （{shares} 股）</Text>
          </Text>
        </View>
        <View className="trade-panel__summary-row">
          <Text className="trade-panel__label">总资产</Text>
          <Text className="trade-panel__value trade-panel__value--strong">
            {formatMoney(totalAssets)}
          </Text>
        </View>
        <View className="trade-panel__summary-row">
          <Text className="trade-panel__label">当日价</Text>
          <Text className="trade-panel__value">
            {formatMoney(price)}
            {changePct !== undefined && (
              <Text className={changeClass}> {formatPct(changePct)}</Text>
            )}
          </Text>
        </View>
        <View className="trade-panel__summary-row">
          <Text className="trade-panel__label">剩余天数</Text>
          <Text className="trade-panel__value">
            {daysLeft}
            {totalDays !== undefined && (
              <Text className="trade-panel__sub"> / {totalDays}</Text>
            )}
          </Text>
        </View>
      </View>

      {/* 停牌 / 跳复牌 */}
      {!tradable && !finished && (
        <View className="trade-panel__halt">
          <Text className="trade-panel__halt-text">停牌中 · 价格冻结，无法买卖</Text>
          {skipToResumeVisible && (
            <Button
              className="trade-panel__btn trade-panel__btn--resume"
              onClick={onSkipToResume}
            >
              跳到复牌首日
            </Button>
          )}
        </View>
      )}

      {finished && (
        <View className="trade-panel__halt">
          <Text className="trade-panel__halt-text">本局已结束</Text>
        </View>
      )}

      {/* 买入区 */}
      <View className="trade-panel__section">
        <View className="trade-panel__section-head">
          <Text className="trade-panel__section-title">买入</Text>
          <Text className="trade-panel__section-meta">按现金 {buyPct}%</Text>
        </View>
        <Slider
          className="trade-panel__slider"
          min={0}
          max={100}
          step={1}
          value={buyPct}
          disabled={!canBuy}
          showValue
          onChange={(e) => setBuyPct(e.detail.value)}
        />
        <View className="trade-panel__quick">
          {QUICK_RATIOS.map((r) => (
            <Button
              key={`buy-${r}`}
              className={
                buyPct === r
                  ? 'trade-panel__quick-btn trade-panel__quick-btn--active'
                  : 'trade-panel__quick-btn'
              }
              disabled={!canBuy}
              onClick={() => setBuyPct(r)}
            >
              {r}%
            </Button>
          ))}
        </View>
        <Button
          className="trade-panel__btn trade-panel__btn--buy"
          disabled={!canBuy || buyPct <= 0}
          onClick={() => onBuy(buyPct / 100)}
        >
          买入
        </Button>
      </View>

      {/* 卖出区 */}
      <View className="trade-panel__section">
        <View className="trade-panel__section-head">
          <Text className="trade-panel__section-title">卖出</Text>
          <Text className="trade-panel__section-meta">按持仓 {sellPct}%</Text>
        </View>
        <Slider
          className="trade-panel__slider"
          min={0}
          max={100}
          step={1}
          value={sellPct}
          disabled={!canSell}
          showValue
          onChange={(e) => setSellPct(e.detail.value)}
        />
        <View className="trade-panel__quick">
          {QUICK_RATIOS.map((r) => (
            <Button
              key={`sell-${r}`}
              className={
                sellPct === r
                  ? 'trade-panel__quick-btn trade-panel__quick-btn--active'
                  : 'trade-panel__quick-btn'
              }
              disabled={!canSell}
              onClick={() => setSellPct(r)}
            >
              {r}%
            </Button>
          ))}
        </View>
        <Button
          className="trade-panel__btn trade-panel__btn--sell"
          disabled={!canSell || sellPct <= 0}
          onClick={() => onSell(sellPct / 100)}
        >
          卖出
        </Button>
      </View>

      {/* 持有 / 推进 */}
      <View className="trade-panel__actions">
        <Button
          className="trade-panel__btn trade-panel__btn--hold"
          disabled={finished}
          onClick={onHold}
        >
          持有
        </Button>
        <Button
          className="trade-panel__btn trade-panel__btn--advance"
          disabled={finished}
          onClick={onAdvance}
        >
          下一日
        </Button>
      </View>
    </View>
  )
}
