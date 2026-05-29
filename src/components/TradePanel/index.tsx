/**
 * 交易面板组件（纯展示 + 回调）。
 *
 * 设计原则：本组件零业务逻辑，所有数值由上层（集成层 / store）从 GameState 与当前 DayBar 派生后通过
 * props 传入，所有用户操作以回调形式抛回上层（由 engine.applyAction 处理）。
 * 仅使用 Taro 组件（View/Text/Slider/Button），保证 H5 可用且未来可移植小程序。
 *
 * 交互规则（UI 层）：
 * - 买入按现金百分比（含 25/50/75/100 快捷档），卖出按持仓百分比。
 * - 买入 / 卖出通过 segmented 分段切换，同一时刻只暴露一种操作（降误触）。
 * - 停牌时（tradable=false）禁用买/卖按钮与滑条，价格冻结仅展示。
 * - "跳到复牌首日"按钮仅在 skipToResumeVisible=true（超长停牌）时出现。
 * - 退市 / 结束（finished）时禁用全部交易操作。
 *
 * 视觉：游戏化交易终端令牌（红涨绿跌、tabular-nums、发光 CTA）。仅样式与结构改动，props 契约不变。
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
  /** 当前持仓的平均成本价（移动加权）；无持仓时可不传 / 传 0 */
  avgCost?: number
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

/** 交易方向（UI 内部分段状态） */
type Side = 'buy' | 'sell'

function formatMoney(n: number): string {
  return n.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function formatInt(n: number): string {
  return Math.round(n).toLocaleString('en-US')
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
    avgCost = 0,
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

  // 分段方向 + 各自滑条百分比（0~100），均为本组件内部 UI 状态，不持有业务状态。
  const [side, setSide] = useState<Side>('buy')
  const [buyPct, setBuyPct] = useState(50)
  const [sellPct, setSellPct] = useState(50)

  // 派生展示值（纯计算，不可变）
  const positionValue = shares * price
  const totalAssets = cash + positionValue

  // 持仓成本与浮动盈亏（仅持仓时有意义；红涨绿跌）
  const holding = shares > 0 && avgCost > 0
  const floatPnlPct = holding ? price / avgCost - 1 : 0
  const floatPnl = holding ? (price - avgCost) * shares : 0
  const pnlUp = floatPnl > 0
  const pnlDown = floatPnl < 0

  // 当日涨跌方向 → 胶囊 / 总资产数字配色
  const upDay = changePct !== undefined && changePct > 0
  const downDay = changePct !== undefined && changePct < 0

  // 是否禁用交易操作：停牌、已结束。
  const tradingDisabled = !tradable || finished
  const canBuy = tradingDisabled ? false : cash > 0
  const canSell = tradingDisabled ? false : shares > 0

  // 当前分段派生
  const isBuy = side === 'buy'
  const pct = isBuy ? buyPct : sellPct
  const setPct = isBuy ? setBuyPct : setSellPct
  const canAct = isBuy ? canBuy : canSell

  // 实时预估（仅展示，引擎为最终裁决）
  const estBuyShares = price > 0 ? Math.floor((cash * (buyPct / 100)) / price) : 0
  const estSellShares = Math.floor(shares * (sellPct / 100))
  const estShares = isBuy ? estBuyShares : estSellShares
  const estAmount = isBuy ? estBuyShares * price : estSellShares * price

  return (
    <View className="trade-panel">
      {/* ── 盘面数据卡：总资产独占首行 + 三栏次级 + 当日涨跌胶囊 ── */}
      <View className="trade-panel__summary">
        <View className="trade-panel__assets">
          <Text className="trade-panel__label">总资产</Text>
          <View className="trade-panel__assets-line">
            <Text className="trade-panel__value trade-panel__value--strong num">
              {formatMoney(totalAssets)}
            </Text>
            {changePct !== undefined && (
              <Text
                className={
                  upDay
                    ? 'trade-panel__chip trade-panel__chip--up num'
                    : downDay
                      ? 'trade-panel__chip trade-panel__chip--down num'
                      : 'trade-panel__chip trade-panel__chip--flat num'
                }
              >
                {upDay ? '▲ ' : downDay ? '▼ ' : ''}
                {formatPct(changePct)}
              </Text>
            )}
          </View>
        </View>

        <View className="trade-panel__stats">
          <View className="trade-panel__stat">
            <Text className="trade-panel__stat-label">现金</Text>
            <Text className="trade-panel__stat-val num">{formatMoney(cash)}</Text>
          </View>
          <View className="trade-panel__stat trade-panel__stat--mid">
            <Text className="trade-panel__stat-label">持仓</Text>
            <Text className="trade-panel__stat-val num">{formatInt(shares)} 股</Text>
          </View>
          <View className="trade-panel__stat">
            <Text className="trade-panel__stat-label">当日价</Text>
            <Text className="trade-panel__stat-val num">{formatMoney(price)}</Text>
          </View>
        </View>

        {holding && (
          <View className="trade-panel__holding">
            <View className="trade-panel__holding-item">
              <Text className="trade-panel__stat-label">持仓成本</Text>
              <Text className="trade-panel__stat-val num">{formatMoney(avgCost)}</Text>
            </View>
            <View className="trade-panel__holding-item trade-panel__holding-item--end">
              <Text className="trade-panel__stat-label">浮动盈亏</Text>
              <Text
                className={
                  pnlUp
                    ? 'trade-panel__stat-val trade-panel__pnl--up num'
                    : pnlDown
                      ? 'trade-panel__stat-val trade-panel__pnl--down num'
                      : 'trade-panel__stat-val num'
                }
              >
                {pnlUp ? '+' : ''}
                {formatMoney(floatPnl)} ({formatPct(floatPnlPct)})
              </Text>
            </View>
          </View>
        )}

        <View className="trade-panel__progress">
          <Text className="trade-panel__progress-text num">
            剩余 {daysLeft}
            {totalDays !== undefined ? ` / ${totalDays}` : ''} 日
          </Text>
        </View>
      </View>

      {/* ── 停牌 / 结束态 ── */}
      {!tradable && !finished && (
        <View className="trade-panel__halt">
          <Text className="trade-panel__halt-text">⏸ 停牌中 · 价格冻结，无法买卖</Text>
          {skipToResumeVisible && (
            <Button
              className="trade-panel__btn trade-panel__btn--resume"
              onClick={onSkipToResume}
            >
              跳到复牌首日 ⏩
            </Button>
          )}
        </View>
      )}

      {finished && (
        <View className="trade-panel__halt trade-panel__halt--done">
          <Text className="trade-panel__halt-text trade-panel__halt-text--done">
            本局已结束
          </Text>
        </View>
      )}

      {/* ── 交易区（分段切换：买 / 卖；仅在可交易且未结束时展示完整操作）── */}
      {!finished && (
        <View className="trade-panel__trade">
          {/* 分段切换 */}
          <View className="trade-panel__segment">
            <View
              className={
                isBuy
                  ? 'trade-panel__seg trade-panel__seg--buy trade-panel__seg--active'
                  : 'trade-panel__seg'
              }
              onClick={() => setSide('buy')}
            >
              <Text className="trade-panel__seg-text">买入</Text>
            </View>
            <View
              className={
                !isBuy
                  ? 'trade-panel__seg trade-panel__seg--sell trade-panel__seg--active'
                  : 'trade-panel__seg'
              }
              onClick={() => setSide('sell')}
            >
              <Text className="trade-panel__seg-text">卖出</Text>
            </View>
          </View>

          {/* 快捷档 */}
          <View className="trade-panel__quick">
            {QUICK_RATIOS.map((r) => {
              const active = pct === r
              const cls = active
                ? isBuy
                  ? 'trade-panel__quick-btn trade-panel__quick-btn--buy'
                  : 'trade-panel__quick-btn trade-panel__quick-btn--sell'
                : 'trade-panel__quick-btn'
              return (
                <Button
                  key={`${side}-${r}`}
                  className={cls}
                  disabled={!canAct || undefined}
                  onClick={() => setPct(r)}
                >
                  {r}%
                </Button>
              )
            })}
          </View>

          {/* 滑条 + 实时预估 */}
          <Slider
            className="trade-panel__slider"
            min={0}
            max={100}
            step={1}
            value={pct}
            disabled={!canAct}
            activeColor={isBuy ? '#ff3b3b' : '#00d27a'}
            blockColor={isBuy ? '#ff5c5c' : '#26ff9c'}
            backgroundColor="#1c2230"
            showValue
            onChange={(e) => setPct(e.detail.value)}
          />
          <View className="trade-panel__estimate">
            <Text className="trade-panel__est-label">
              {isBuy ? '预计买入' : '预计卖出'}
            </Text>
            <Text className="trade-panel__est-val num">
              {formatInt(estShares)} 股 · ¥{formatMoney(estAmount)}
            </Text>
          </View>

          {/* 主操作按钮（随分段变色 + 光晕） */}
          {isBuy ? (
            <Button
              className="trade-panel__btn trade-panel__btn--buy"
              disabled={!canBuy || buyPct <= 0 || undefined}
              onClick={() => onBuy(buyPct / 100)}
            >
              买入 +{formatInt(estBuyShares)} 股
            </Button>
          ) : (
            <Button
              className="trade-panel__btn trade-panel__btn--sell"
              disabled={!canSell || sellPct <= 0 || undefined}
              onClick={() => onSell(sellPct / 100)}
            >
              卖出 -{formatInt(estSellShares)} 股
            </Button>
          )}
        </View>
      )}

      {/* ── 持有 / 推进 ── */}
      <View className="trade-panel__actions">
        <Button
          className="trade-panel__btn trade-panel__btn--hold"
          disabled={finished || undefined}
          onClick={onHold}
        >
          持有 →
        </Button>
        <Button
          className="trade-panel__btn trade-panel__btn--advance"
          disabled={finished || undefined}
          onClick={onAdvance}
        >
          下一日 ⏭
        </Button>
      </View>
    </View>
  )
}
