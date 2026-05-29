/**
 * K 线图组件（受控展示组件）。
 *
 * 基于 klinecharts v9 渲染逐日揭示的 K 线 + 成交量 + 均线 + 指标。
 *
 * 设计原则：
 * - 纯展示，不含任何游戏逻辑，不读取关卡其它字段。
 * - 严格脱敏：X 轴只展示相对日序（第 N 日），不渲染真实日期 / 名称 / 代码。
 * - 受控：父层每揭示一日就把更长的 days 数组传进来；本组件在内部做最小化更新
 *   （新增一日走 updateData，整体替换走 applyNewData），实现逐日平滑揭示。
 * - 停牌日（tradable=false）以灰色蒙层 + 标记做视觉区分。
 */
import { useEffect, useRef } from 'react'
import { View, Text } from '@tarojs/components'
import {
  init,
  dispose,
  registerIndicator,
  type Chart,
  type KLineData,
  type Styles,
  type DeepPartial,
} from 'klinecharts'
import type { DayBar } from '../../types/contract'
import './index.css'

/**
 * 画布主题（必须用字面量颜色 —— canvas 无法读取 CSS 变量）。
 * 取值与 src/styles/tokens.css 设计令牌严格对齐，仅在此处镜像一份给 klinecharts。
 *
 * 【A股配色铁律：红涨绿跌】K 线 / 量柱 / MACD / 指标方向色：涨 = 红，跌 = 青绿。
 */
const C = {
  bgSurface: '#161b22',
  raised: '#1c2230',
  up: '#ff3b3b',
  down: '#00d27a',
  upWick: '#ff5c5c',
  downWick: '#26ff9c',
  accent: '#3d8bff',
  gold: '#ffc53d',
  warn: '#d8a425',
  t1: '#f5f8ff',
  t2: '#c9d1d9',
  t3: '#8b949e',
  t4: '#5b6675',
  grid: 'rgba(48,54,61,0.55)',
  border: '#21262d',
  fontNum: "'SF Mono','Roboto Mono','DIN Alternate',ui-monospace,monospace",
}

/**
 * klinecharts 全局样式：把默认浅色主题改写为「游戏化交易终端」深色盘面。
 * - 主图蜡烛红涨绿跌、影线高亮；最新价标线用强调蓝。
 * - 网格极淡、X/Y 轴文案等宽冷灰，盘面专业感。
 * - 副图（VOL/MACD/RSI）指标方向色同样红涨绿跌；均线 MA5/10/20 用金/蓝/灰区分。
 * - tooltip / crosshair 暗底高对比，分隔线与容器底色协调。
 */
const CHART_STYLES = {
  grid: {
    show: true,
    horizontal: { show: true, size: 1, color: C.grid, style: 'dashed', dashedValue: [2, 3] },
    vertical: { show: false, size: 1, color: C.grid, style: 'dashed', dashedValue: [2, 3] },
  },
  candle: {
    bar: {
      upColor: C.up,
      downColor: C.down,
      noChangeColor: C.t3,
      upBorderColor: C.up,
      downBorderColor: C.down,
      noChangeBorderColor: C.t3,
      upWickColor: C.upWick,
      downWickColor: C.downWick,
      noChangeWickColor: C.t3,
    },
    priceMark: {
      high: { color: C.t2, textSize: 10, textFamily: C.fontNum },
      low: { color: C.t2, textSize: 10, textFamily: C.fontNum },
      last: {
        show: true,
        upColor: C.up,
        downColor: C.down,
        noChangeColor: C.t3,
        line: { show: true, style: 'dashed', dashedValue: [4, 4], size: 1 },
        text: {
          show: true,
          size: 11,
          family: C.fontNum,
          weight: '600',
          color: '#ffffff',
          borderRadius: 3,
          paddingLeft: 4,
          paddingRight: 4,
          paddingTop: 2,
          paddingBottom: 2,
        },
      },
    },
    tooltip: {
      showRule: 'follow_cross',
      text: { size: 11, family: C.fontNum, color: C.t2, marginLeft: 8, marginTop: 6, marginRight: 8, marginBottom: 0 },
    },
  },
  indicator: {
    ohlc: { upColor: C.up, downColor: C.down, noChangeColor: C.t3 },
    bars: [
      {
        style: 'fill',
        borderStyle: 'solid',
        borderSize: 1,
        upColor: C.up,
        downColor: C.down,
        noChangeColor: C.t3,
      },
    ],
    // 均线 / 指标线：金、蓝、灰，与盘面强调色体系一致
    lines: [
      { color: C.gold, size: 1 },
      { color: C.accent, size: 1 },
      { color: C.t3, size: 1 },
      { color: C.upWick, size: 1 },
    ],
    lastValueMark: { show: false, text: { color: '#ffffff', size: 10, family: C.fontNum } },
    tooltip: {
      showRule: 'follow_cross',
      showName: true,
      showParams: true,
      text: { size: 10, family: C.fontNum, color: C.t3, marginLeft: 8, marginTop: 4, marginRight: 6, marginBottom: 0 },
    },
  },
  xAxis: {
    axisLine: { show: true, color: C.border, size: 1 },
    tickLine: { show: true, color: C.border, size: 1, length: 3 },
    tickText: { show: true, color: C.t3, size: 10, family: C.fontNum, weight: 'normal' },
  },
  yAxis: {
    axisLine: { show: false, color: C.border, size: 1 },
    tickLine: { show: false, color: C.border, size: 1, length: 3 },
    tickText: { show: true, color: C.t3, size: 10, family: C.fontNum, weight: 'normal' },
  },
  separator: {
    size: 1,
    color: C.border,
    fill: true,
    activeBackgroundColor: 'rgba(61,139,255,0.10)',
  },
  crosshair: {
    show: true,
    horizontal: {
      show: true,
      line: { show: true, style: 'dashed', dashedValue: [4, 2], size: 1, color: C.t4 },
      text: { show: true, color: '#ffffff', size: 11, family: C.fontNum, backgroundColor: C.raised, borderColor: C.border, borderRadius: 3, paddingLeft: 4, paddingRight: 4, paddingTop: 2, paddingBottom: 2 },
    },
    vertical: {
      show: true,
      line: { show: true, style: 'dashed', dashedValue: [4, 2], size: 1, color: C.t4 },
      text: { show: true, color: '#ffffff', size: 11, family: C.fontNum, backgroundColor: C.raised, borderColor: C.border, borderRadius: 3, paddingLeft: 4, paddingRight: 4, paddingTop: 2, paddingBottom: 2 },
    },
  },
} as const

/** 父层可控制显示哪些指标。 */
export interface ChartProps {
  /**
   * 已揭示的逐日行情（从 day 0 到 currentDay，含当日）。
   * 父层只需在推进一日后追加元素并传入新数组引用即可触发平滑更新。
   */
  days: DayBar[]
  /** 是否显示均线 MA5/10/20（叠加在主图）。默认 true。 */
  showMA?: boolean
  /** 是否显示成交量副图。默认 true。 */
  showVOL?: boolean
  /** 是否显示 MACD 副图。默认 true。 */
  showMACD?: boolean
  /** 是否显示 RSI 副图。默认 false。 */
  showRSI?: boolean
  /** 容器高度（px）。默认 420。 */
  height?: number
}

/** 自定义停牌蒙层指标名（叠加在主图，不产生数值）。 */
const HALT_INDICATOR = 'HALT_OVERLAY'

let haltRegistered = false

/**
 * 注册一个无数值的自定义指标，叠加在 K 线主图上：
 * 对 tradable=false 的交易日整列绘制半透明灰色蒙层 + 顶部标记，
 * 在视觉上把停牌日与正常交易日区分开。
 */
function ensureHaltIndicatorRegistered(): void {
  if (haltRegistered) return
  haltRegistered = true
  registerIndicator({
    name: HALT_INDICATOR,
    shortName: '停牌',
    // 不画线、不参与坐标计算；calc 返回与数据等长的占位即可。
    calc: (dataList) => dataList.map(() => ({})),
    draw: ({ ctx, kLineDataList, visibleRange, barSpace, bounding, xAxis }) => {
      const { from, to } = visibleRange
      ctx.save()
      for (let i = from; i < to; i++) {
        const data = kLineDataList[i] as KLineData & { halt?: boolean }
        if (!data || !data.halt) continue
        const x = xAxis.convertToPixel(i)
        const left = x - barSpace.halfBar
        const width = barSpace.bar
        // 停牌列：琥珀警示蒙层（与设计令牌 --warn / 交易面板停牌态一致）覆盖整列
        ctx.fillStyle = 'rgba(216, 164, 37, 0.16)'
        ctx.fillRect(left, bounding.top, width, bounding.height)
        // 列两侧极细琥珀边界，强化「冻结区间」边界感
        ctx.fillStyle = 'rgba(216, 164, 37, 0.45)'
        ctx.fillRect(left, bounding.top, 1, bounding.height)
        ctx.fillRect(left + width - 1, bounding.top, 1, bounding.height)
        // 顶部停牌标记点（琥珀）
        ctx.fillStyle = 'rgba(216, 164, 37, 0.95)'
        ctx.beginPath()
        ctx.arc(x, bounding.top + 6, 2.5, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.restore()
      // 返回 false 表示不绘制默认图形（本指标无默认图形）
      return false
    },
  })
}

/**
 * 把脱敏的 DayBar 映射为 klinecharts 的 KLineData。
 *
 * 时间戳处理：klinecharts 需要 timestamp 字段做 X 轴定位。我们用相对日序合成一个
 * 「自纪元起第 N 天」的虚拟时间戳（仅用于内部排序/定位），并通过 customApi 把 X 轴
 * 文案改写成「第 N 日」，确保不泄露真实日期。
 */
const DAY_MS = 24 * 60 * 60 * 1000

function toKLineData(bar: DayBar): KLineData & { halt: boolean; relDay: number } {
  return {
    timestamp: bar.day * DAY_MS,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
    turnover: bar.turnover,
    // 附带字段：供停牌蒙层指标与 X 轴格式化使用
    halt: bar.tradable === false,
    relDay: bar.day,
  }
}

export default function Chart(props: ChartProps) {
  const {
    days,
    showMA = true,
    showVOL = true,
    showMACD = true,
    showRSI = false,
    height = 420,
  } = props

  const containerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<Chart | null>(null)
  // 已渲染到图表的数据长度，用于判断「追加一日」还是「整体替换」。
  const renderedLenRef = useRef(0)
  // 副图指标的 paneId，便于按 props 增删。
  const paneIdsRef = useRef<{ vol?: string; macd?: string; rsi?: string }>({})

  // 初始化与销毁
  useEffect(() => {
    ensureHaltIndicatorRegistered()
    const el = containerRef.current
    if (!el) return

    const chart = init(el, {
      // X 轴只展示相对日序，绝不泄露真实日期
      customApi: {
        formatDate: (_dateTimeFormat, timestamp) => {
          const relDay = Math.round(timestamp / DAY_MS)
          return `第${relDay}日`
        },
      },
      // 「游戏化交易终端」深色盘面主题（红涨绿跌）
      styles: CHART_STYLES as unknown as DeepPartial<Styles>,
    })
    chartRef.current = chart
    renderedLenRef.current = 0

    return () => {
      if (chartRef.current) {
        dispose(el)
        chartRef.current = null
        renderedLenRef.current = 0
        paneIdsRef.current = {}
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 主图指标（MA + 停牌蒙层）按 showMA 切换
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    // 停牌蒙层：始终叠加在主图（candle_pane）
    chart.createIndicator(HALT_INDICATOR, true, { id: 'candle_pane' })
    if (showMA) {
      chart.createIndicator('MA', true, { id: 'candle_pane' })
    } else {
      chart.removeIndicator('candle_pane', 'MA')
    }
  }, [showMA])

  // 成交量副图
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    if (showVOL) {
      const id = chart.createIndicator('VOL', false, { id: paneIdsRef.current.vol })
      if (id) paneIdsRef.current.vol = id
    } else if (paneIdsRef.current.vol) {
      chart.removeIndicator(paneIdsRef.current.vol)
      paneIdsRef.current.vol = undefined
    }
  }, [showVOL])

  // MACD 副图
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    if (showMACD) {
      const id = chart.createIndicator('MACD', false, { id: paneIdsRef.current.macd })
      if (id) paneIdsRef.current.macd = id
    } else if (paneIdsRef.current.macd) {
      chart.removeIndicator(paneIdsRef.current.macd)
      paneIdsRef.current.macd = undefined
    }
  }, [showMACD])

  // RSI 副图
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    if (showRSI) {
      const id = chart.createIndicator('RSI', false, { id: paneIdsRef.current.rsi })
      if (id) paneIdsRef.current.rsi = id
    } else if (paneIdsRef.current.rsi) {
      chart.removeIndicator(paneIdsRef.current.rsi)
      paneIdsRef.current.rsi = undefined
    }
  }, [showRSI])

  // 逐日揭示：数据更新
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return

    const prevLen = renderedLenRef.current
    const nextLen = days.length

    if (nextLen === 0) {
      chart.applyNewData([])
      renderedLenRef.current = 0
      return
    }

    // 仅在末尾追加了 1 日：用 updateData 做平滑增量更新
    if (nextLen === prevLen + 1 && prevLen > 0) {
      chart.updateData(toKLineData(days[nextLen - 1]))
    } else {
      // 首次渲染或非单步变化（换关 / 回放）：整体替换
      chart.applyNewData(days.map(toKLineData))
    }
    renderedLenRef.current = nextLen
  }, [days])

  return (
    <View className="kline-shell">
      {/* 终端风标题条：行情标识 + 脱敏提示，融入深色盘面 */}
      <View className="kline-shell__bar">
        <View className="kline-shell__brand">
          <View className="kline-shell__dot" />
          <Text className="kline-shell__title">行情盘面</Text>
        </View>
        <Text className="kline-shell__meta num">第 {days.length} 日</Text>
      </View>
      <View
        className="kline-chart"
        style={{ width: '100%', height: `${height}px` }}
        ref={containerRef as unknown as React.Ref<any>}
      />
    </View>
  )
}
