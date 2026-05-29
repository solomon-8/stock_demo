/**
 * 结算 / 复盘组件（纯展示，Taro + React，H5 可用）。
 *
 * 职责：
 * - 展示本局成绩：最终总资产、收益率%、评级 S/A/B/C/D。
 * - 与 "全程持有不动"(buy & hold) 基准对比，给出跑赢 / 跑输结论。
 * - 事后揭盘 "这只股票其实……"：依据 reveal 文案 + events 还原 ST / 退市 / 停牌真相。
 * - 关键交易回顾：按 history 列出买 / 卖 / 跳复牌等操作。
 * - 提供 "晒战绩"（主 CTA，金辉）与 "再来一局"（次级）按钮。
 *
 * 本组件零业务逻辑：所有数值由引擎 settle() 与 GameState 提供，组件只负责呈现。
 *
 * 视觉：游戏化交易终端 —— 评级徽章光效、收益率大字（红涨绿跌）、对比卡胜负高亮、
 * 战绩标语（截图钩子）、入场"开奖"动效。全部使用 src/styles/tokens.css 设计令牌。
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

/**
 * 评级对应的主题色（令牌名）、称号与一句话点评。
 * 红涨绿跌：S/A 用金辉，B 用上涨红，C 用中性灰，D 用下跌绿（"接盘"惩罚色）。
 */
const GRADE_META: Record<
  SettleResult['grade'],
  { color: string; glow: string; label: string; spin: boolean }
> = {
  S: { color: 'var(--gold)', glow: 'var(--gold-glow)', label: '股神', spin: true },
  A: { color: 'var(--gold)', glow: 'var(--gold-glow)', label: '操盘手', spin: true },
  B: { color: 'var(--up)', glow: 'var(--up-glow)', label: '老股民', spin: false },
  C: { color: 'var(--t3)', glow: 'rgba(139,148,158,0.45)', label: '萌新', spin: false },
  D: { color: 'var(--down)', glow: 'var(--down-glow)', label: '韭菜', spin: false },
}

/** 战绩标语（截图核心钩子）：按评级 + 是否盈利择一。 */
function sloganOf(grade: SettleResult['grade'], roi: number): string {
  switch (grade) {
    case 'S':
      return roi >= 1 ? '十日翻倍，你看穿了庄家' : '封神局！盘感拉满'
    case 'A':
      return '稳准狠，这波操作教科书级'
    case 'B':
      return '小有斩获，离股神就差一步'
    case 'C':
      return roi >= 0 ? '勉强保本，下次再搏一把' : '小亏离场，及时止损也是赢'
    case 'D':
    default:
      return roi <= -0.99 ? '惨遭归零，这是个雷啊' : '高位接盘，下次别追高了'
  }
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
  // A股语境：红涨绿跌
  const up = roi >= 0
  const profitClass = up ? 'result--up' : 'result--down'
  const initial =
    startCash != null ? startCash : roi !== -1 ? finalAssets / (1 + roi) : 0
  const profit = finalAssets - initial

  // 与 buy&hold 对比结论
  const diff = roi - buyHoldRoi
  const beat = diff > 1e-9
  const tie = Math.abs(diff) < 1e-9
  const vsBuyHold = tie
    ? '与全程持有打平'
    : beat
      ? `🔥 跑赢全程持有 ${fmtPct(diff)}`
      : `跑输全程持有 ${fmtPct(-diff)}`

  const slogan = sloganOf(grade, roi)

  // 仅保留有信息量的关键交易（买 / 卖 / 跳复牌），过滤 hold / advance 噪声
  const keyTrades = (history ?? []).filter(
    (h) => h.action === 'buy' || h.action === 'sell' || h.action === 'skipToResume',
  )

  return (
    <View className="result">
      {/* 成绩头部 —— 战绩卡主战场 */}
      <View className="result__header">
        <View
          className={`result__grade result__grade--enter${gradeMeta.spin ? ' result__grade--spin' : ''}`}
          style={{
            borderColor: gradeMeta.color,
            color: gradeMeta.color,
            boxShadow: `0 0 32px ${gradeMeta.glow}, inset 0 0 18px ${gradeMeta.glow}`,
          }}
        >
          {gradeMeta.spin ? (
            <View
              className="result__grade-halo"
              style={{
                background: `conic-gradient(from 0deg, transparent, ${gradeMeta.color}, transparent 75%)`,
              }}
            />
          ) : null}
          <Text className="result__grade-letter">{grade}</Text>
          <Text className="result__grade-label">{gradeMeta.label}</Text>
        </View>

        <View className="result__score">
          <Text className={`result__roi num ${profitClass}`}>
            {up ? '▲ ' : '▼ '}
            {fmtPct(roi)}
          </Text>
          <Text className="result__assets">
            最终总资产 <Text className="num">{fmtMoney(finalAssets)}</Text>
          </Text>
          <Text className={`result__profit num ${profitClass}`}>
            {profit >= 0 ? '盈利' : '亏损'} {fmtMoney(Math.abs(profit))}
            <Text className="result__profit-base">
              {' '}
              · 本金 {fmtMoney(initial)}
            </Text>
          </Text>
        </View>
      </View>

      {/* 战绩标语（截图钩子，金色） */}
      <Text className="result__slogan">“{slogan}”</Text>

      {/* buy & hold 基准对比 */}
      <View className="result__card">
        <Text className="result__card-title">你 vs 一直拿着不动</Text>
        <View className="result__compare">
          <View
            className={`result__compare-col${beat ? ' result__compare-col--win' : ''}`}
          >
            <Text className="result__compare-cap">你的操作</Text>
            <Text className={`result__compare-val num ${profitClass}`}>
              {fmtPct(roi)}
            </Text>
          </View>
          <View className="result__compare-vs">
            <Text className="result__compare-vs-text">VS</Text>
          </View>
          <View
            className={`result__compare-col${!beat && !tie ? ' result__compare-col--win' : ''}`}
          >
            <Text className="result__compare-cap">死拿不动</Text>
            <Text
              className={`result__compare-val num ${buyHoldRoi >= 0 ? 'result--up' : 'result--down'}`}
            >
              {fmtPct(buyHoldRoi)}
            </Text>
          </View>
        </View>
        <Text
          className={`result__compare-verdict${beat ? ' result__compare-verdict--win' : ''}`}
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
                <Text className="result__history-day num">第 {h.day} 日</Text>
                <Text
                  className={`result__history-action${h.action === 'buy' ? ' result--up' : h.action === 'sell' ? ' result--down' : ''}`}
                >
                  {ACTION_LABEL[h.action]}
                </Text>
                <Text className="result__history-price num">
                  价 {h.price.toFixed(2)}
                </Text>
                <Text className="result__history-pos num">持 {h.shares} 股</Text>
              </View>
            ))}
          </ScrollView>
        </View>
      ) : null}

      {/* 操作按钮：晒战绩 = 主 CTA（金辉，主推传播）；再来一局 = 次级 */}
      <View className="result__actions">
        <Button
          className="result__btn result__btn--primary"
          onClick={onShare}
        >
          📷 晒战绩
        </Button>
        <Button className="result__btn result__btn--ghost" onClick={onRestart}>
          再来一局
        </Button>
      </View>
    </View>
  )
}
