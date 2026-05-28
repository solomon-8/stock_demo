/**
 * 结算 / 复盘组件（纯展示，Taro + React，H5 可用）。
 *
 * 职责：
 * - 展示本局成绩：最终总资产、收益率%、评级 S/A/B/C/D。
 * - 与 "全程持有不动"(buy & hold) 基准对比，给出跑赢 / 跑输结论。
 * - 事后揭盘 "这只股票其实……"：依据 reveal 文案 + events 还原 ST / 退市 / 停牌真相。
 * - 关键交易回顾：按 history 列出买 / 卖 / 跳复牌等操作。
 * - 提供 "再来一局" 与 "分享"（占位）按钮。
 *
 * 本组件零业务逻辑：所有数值由引擎 settle() 与 GameState 提供，组件只负责呈现。
 */
import { View, Text, Button, ScrollView } from '@tarojs/components'
import type { SettleResult, HistoryEntry } from '../../engine'
import type { MarketEvent } from '../../types/contract'
import './index.css'

export interface ResultProps {
  /** 引擎结算结果：总资产、收益率、评级、buy&hold 基准、揭盘文案 */
  result: SettleResult
  /**
   * 本关事件列表（来自 LevelPack.events），用于复盘揭示 ST / 退市 / 停牌真相。
   * 游戏过程中不暴露，仅结算时传入。可选：缺省则只展示 reveal.story。
   */
  events?: MarketEvent[]
  /**
   * 玩家操作历史（来自 GameState.history），用于关键交易回顾。
   * 可选：缺省则不展示交易回顾区。
   */
  history?: HistoryEntry[]
  /** 初始资金，用于展示绝对盈亏（缺省按收益率反推，仅展示用） */
  startCash?: number
  /** 再来一局回调 */
  onRestart?: () => void
  /** 分享回调（占位，MVP 可不传） */
  onShare?: () => void
}

/** 评级对应的主题色与一句话点评 */
const GRADE_META: Record<
  SettleResult['grade'],
  { color: string; label: string }
> = {
  S: { color: '#f5a623', label: '股神附体' },
  A: { color: '#2ecc71', label: '稳健高手' },
  B: { color: '#3498db', label: '小有斩获' },
  C: { color: '#8b949e', label: '勉强保本' },
  D: { color: '#e74c3c', label: '高位接盘' },
}

/** 事件类型 → 揭盘真相文案 */
const EVENT_TRUTH: Record<MarketEvent['type'], (e: MarketEvent) => string> = {
  halt: (e) =>
    e.resumeDay != null
      ? `第 ${e.startDay} 日起停牌，第 ${e.resumeDay} 日复牌`
      : `第 ${e.startDay} 日起长期停牌，本局未能复牌`,
  st: (e) =>
    `第 ${e.startDay} 日起被实施 ST，涨跌幅收窄（异常指标其实早有暗示）`,
  delist: (e) => `第 ${e.startDay} 日起退市，持仓被锁死、市值归零`,
}

/** 收益率小数 → 带符号百分比字符串 */
function fmtPct(roi: number): string {
  const sign = roi > 0 ? '+' : ''
  return `${sign}${(roi * 100).toFixed(2)}%`
}

/** 金额格式化（千分位，保留 0 位小数） */
function fmtMoney(n: number): string {
  return Math.round(n).toLocaleString('en-US')
}

const ACTION_LABEL: Record<HistoryEntry['action'], string> = {
  buy: '买入',
  sell: '卖出',
  hold: '持有',
  advance: '推进',
  skipToResume: '跳复牌',
}

export default function Result(props: ResultProps) {
  const { result, events, history, startCash, onRestart, onShare } = props
  const { finalAssets, roi, grade, buyHoldRoi, reveal } = result

  const gradeMeta = GRADE_META[grade]
  const profitColor = roi >= 0 ? '#e74c3c' : '#2ecc71' // A股语境：红涨绿跌
  const initial =
    startCash != null ? startCash : roi !== -1 ? finalAssets / (1 + roi) : 0
  const profit = finalAssets - initial

  // 与 buy&hold 对比结论
  const diff = roi - buyHoldRoi
  const vsBuyHold =
    Math.abs(diff) < 1e-9
      ? '与全程持有打平'
      : diff > 0
        ? `跑赢全程持有 ${fmtPct(diff)}`
        : `跑输全程持有 ${fmtPct(-diff)}`

  // 仅保留有信息量的关键交易（买 / 卖 / 跳复牌），过滤 hold / advance 噪声
  const keyTrades = (history ?? []).filter(
    (h) => h.action === 'buy' || h.action === 'sell' || h.action === 'skipToResume',
  )

  return (
    <View className="result">
      {/* 成绩头部 */}
      <View className="result__header">
        <View
          className="result__grade"
          style={{ borderColor: gradeMeta.color, color: gradeMeta.color }}
        >
          <Text className="result__grade-letter">{grade}</Text>
          <Text className="result__grade-label">{gradeMeta.label}</Text>
        </View>
        <View className="result__score">
          <Text className="result__roi" style={{ color: profitColor }}>
            {fmtPct(roi)}
          </Text>
          <Text className="result__assets">
            最终总资产 {fmtMoney(finalAssets)}
          </Text>
          <Text className="result__profit" style={{ color: profitColor }}>
            {profit >= 0 ? '盈利' : '亏损'} {fmtMoney(Math.abs(profit))}
          </Text>
        </View>
      </View>

      {/* buy & hold 基准对比 */}
      <View className="result__card">
        <Text className="result__card-title">对比 · 全程持有不动</Text>
        <View className="result__compare">
          <View className="result__compare-col">
            <Text className="result__compare-cap">你的操作</Text>
            <Text
              className="result__compare-val"
              style={{ color: profitColor }}
            >
              {fmtPct(roi)}
            </Text>
          </View>
          <View className="result__compare-col">
            <Text className="result__compare-cap">全程持有</Text>
            <Text
              className="result__compare-val"
              style={{ color: buyHoldRoi >= 0 ? '#e74c3c' : '#2ecc71' }}
            >
              {fmtPct(buyHoldRoi)}
            </Text>
          </View>
        </View>
        <Text
          className="result__compare-verdict"
          style={{ color: diff >= 0 ? '#e74c3c' : '#2ecc71' }}
        >
          {vsBuyHold}
        </Text>
      </View>

      {/* 事后揭盘：这只股票其实…… */}
      <View className="result__card">
        <Text className="result__card-title">复盘 · 这只股票其实……</Text>
        {reveal.outcomeTags?.length ? (
          <View className="result__tags">
            {reveal.outcomeTags.map((tag) => (
              <Text key={tag} className="result__tag">
                {tag}
              </Text>
            ))}
          </View>
        ) : null}
        {events?.length ? (
          <View className="result__truths">
            {events.map((e, i) => (
              <Text key={`${e.type}-${e.startDay}-${i}`} className="result__truth">
                · {EVENT_TRUTH[e.type](e)}
              </Text>
            ))}
          </View>
        ) : null}
        <Text className="result__story">{reveal.story}</Text>
      </View>

      {/* 关键交易回顾 */}
      {keyTrades.length ? (
        <View className="result__card">
          <Text className="result__card-title">关键交易回顾</Text>
          <ScrollView scrollY className="result__history">
            {keyTrades.map((h, i) => (
              <View key={`${h.day}-${i}`} className="result__history-row">
                <Text className="result__history-day">第 {h.day} 日</Text>
                <Text className="result__history-action">
                  {ACTION_LABEL[h.action]}
                </Text>
                <Text className="result__history-price">
                  价 {h.price.toFixed(2)}
                </Text>
                <Text className="result__history-pos">持 {h.shares} 股</Text>
              </View>
            ))}
          </ScrollView>
        </View>
      ) : null}

      {/* 操作按钮 */}
      <View className="result__actions">
        <Button
          className="result__btn result__btn--primary"
          onClick={onRestart}
        >
          再来一局
        </Button>
        <Button className="result__btn result__btn--ghost" onClick={onShare}>
          分享战绩
        </Button>
      </View>
    </View>
  )
}
