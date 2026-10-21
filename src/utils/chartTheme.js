// 大屏图表统一视觉配置
export const PALETTE = ['#00d4ff', '#3b7cff', '#886eff', '#ffc722', '#00e2a1', '#ff7c5c', '#e665b0']

export const AXIS_LABEL_COLOR = '#7ec7ff'
export const AXIS_LINE_COLOR = 'rgba(64, 110, 180, 0.45)'
export const SPLIT_LINE_COLOR = 'rgba(64, 110, 180, 0.22)'
export const LEGEND_COLOR = '#b7d3f0'

export const tooltipStyle = {
  backgroundColor: 'rgba(6, 18, 40, 0.92)',
  borderColor: 'rgba(0, 212, 255, 0.4)',
  borderWidth: 1,
  textStyle: { color: '#d8ecff', fontSize: 12 },
  extraCssText: 'backdrop-filter: blur(4px); box-shadow: 0 0 12px rgba(0,212,255,0.15);',
}

export const legendStyle = {
  top: 4,
  left: 'center',
  itemWidth: 10,
  itemHeight: 10,
  icon: 'roundRect',
  textStyle: { color: LEGEND_COLOR, fontSize: 12 },
}

export function categoryAxis(extra = {}) {
  return {
    type: 'category',
    axisLabel: { color: AXIS_LABEL_COLOR, fontSize: 11 },
    axisLine: { lineStyle: { color: AXIS_LINE_COLOR } },
    axisTick: { show: false },
    ...extra,
  }
}

export function valueAxis(extra = {}) {
  return {
    type: 'value',
    minInterval: 1,
    axisLabel: { color: AXIS_LABEL_COLOR, fontSize: 11 },
    axisLine: { show: false },
    splitLine: { lineStyle: { color: SPLIT_LINE_COLOR, type: 'dashed' } },
    ...extra,
  }
}
