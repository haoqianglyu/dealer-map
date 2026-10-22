// 大屏图表统一视觉配置；亮色值见 docs/fable-light-theme.md §2.4。
// 读 theme.value：在 computed option 里调用即可在切换主题时重算（EChart 用 setOption(opt, true) 重画）
import { theme } from '@/composables/useTheme'

const DARK = {
  palette: ['#00d4ff', '#3b7cff', '#886eff', '#ffc722', '#00e2a1', '#ff7c5c', '#e665b0'],
  axisLabel: '#7ec7ff',
  axisLine: 'rgba(64, 110, 180, 0.45)',
  splitLine: 'rgba(64, 110, 180, 0.22)',
  legend: '#b7d3f0',
  tooltip: {
    backgroundColor: 'rgba(6, 18, 40, 0.92)',
    borderColor: 'rgba(0, 212, 255, 0.4)',
    borderWidth: 1,
    textStyle: { color: '#d8ecff', fontSize: 12 },
    extraCssText: 'backdrop-filter: blur(4px); box-shadow: 0 0 12px rgba(0,212,255,0.15);',
  },
}
const LIGHT = {
  palette: ['#0e7490', '#1d6fd6', '#6d4fd3', '#a16207', '#0f8a5f', '#c2410c', '#b3327d'],
  axisLabel: '#5b6b80',
  axisLine: 'rgba(16, 33, 58, 0.25)',
  splitLine: 'rgba(16, 33, 58, 0.12)',
  legend: '#3b4f6b',
  tooltip: {
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
    borderColor: 'rgba(16, 33, 58, 0.14)',
    borderWidth: 1,
    textStyle: { color: '#10213a', fontSize: 12 },
    extraCssText: 'backdrop-filter: blur(4px); box-shadow: 0 4px 16px rgba(16,33,58,0.14);',
  },
}
export const isLight = () => theme.value === 'light'
export const chartTheme = () => (isLight() ? LIGHT : DARK)

// 深色常量（兼容旧引用）
export const PALETTE = DARK.palette
export const AXIS_LABEL_COLOR = DARK.axisLabel
export const AXIS_LINE_COLOR = DARK.axisLine
export const SPLIT_LINE_COLOR = DARK.splitLine
export const LEGEND_COLOR = DARK.legend

export const tooltipStyle = () => ({ ...chartTheme().tooltip })

export const legendStyle = () => ({
  top: 4,
  left: 'center',
  itemWidth: 10,
  itemHeight: 10,
  icon: 'roundRect',
  textStyle: { color: chartTheme().legend, fontSize: 12 },
})

export function categoryAxis(extra = {}) {
  const t = chartTheme()
  return {
    type: 'category',
    axisLabel: { color: t.axisLabel, fontSize: 11 },
    axisLine: { lineStyle: { color: t.axisLine } },
    axisTick: { show: false },
    ...extra,
  }
}

export function valueAxis(extra = {}) {
  const t = chartTheme()
  return {
    type: 'value',
    minInterval: 1,
    axisLabel: { color: t.axisLabel, fontSize: 11 },
    axisLine: { show: false },
    splitLine: { lineStyle: { color: t.splitLine, type: 'dashed' } },
    ...extra,
  }
}
