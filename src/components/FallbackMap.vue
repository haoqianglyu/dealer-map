<template>
  <EChart :option="option" />
</template>

<script setup>
import { computed } from 'vue'
import * as echarts from 'echarts'
import EChart from './EChart.vue'
import { tooltipStyle, isLight } from '@/utils/chartTheme'

// 无高德 Key（或高德加载失败）时的兜底：本市区县轮廓 + 各区项目数（单色由浅到深）+ 小区近似点
const props = defineProps({
  geojson: { type: Object, default: null },
  mapName: { type: String, default: '' },
  districtStats: { type: Array, default: () => [] }, // [{ name, count, area }]
  points: { type: Array, default: () => [] },
})

const FB_DARK = { range: ['#0b2447', '#124a8c', '#1b77c9', '#20b3e8'], area: '#0b2447', border: 'rgba(0, 212, 255, 0.55)', label: '#b7d3f0', emArea: '#1d5fae', emLabel: '#fff', dot: 'rgba(255, 199, 34, 0.15)', dotBorder: '#ffc722' }
const FB_LIGHT = { range: ['#e6eef2', '#b7d3dc', '#5fa3b6', '#0e7490'], area: '#e6eef2', border: 'rgba(14, 116, 144, 0.55)', label: '#3b4f6b', emArea: '#5fa3b6', emLabel: '#10213a', dot: 'rgba(161, 98, 7, 0.12)', dotBorder: '#a16207' }

const option = computed(() => {
  if (!props.geojson || !props.mapName) return {}
  if (!echarts.getMap(props.mapName)) echarts.registerMap(props.mapName, props.geojson)
  const max = Math.max(1, ...props.districtStats.map((d) => d.count))
  const c = isLight() ? FB_LIGHT : FB_DARK
  return {
    tooltip: { ...tooltipStyle(), trigger: 'item' },
    visualMap: {
      show: false,
      min: 0,
      max,
      seriesIndex: 0,
      inRange: { color: c.range },
    },
    geo: {
      map: props.mapName,
      roam: true,
      layoutCenter: ['40%', '54%'],
      layoutSize: '86%',
      label: { show: true, color: c.label, fontSize: 13 },
      itemStyle: { areaColor: c.area, borderColor: c.border, borderWidth: 1.2 },
      emphasis: { label: { color: c.emLabel }, itemStyle: { areaColor: c.emArea } },
      select: { disabled: true },
    },
    series: [
      {
        type: 'map',
        geoIndex: 0,
        data: props.districtStats.map((d) => ({ name: d.name, value: d.count, area: d.area })),
        tooltip: {
          formatter: (p) =>
            `${p.name}<br/>项目 ${p.data?.value ?? 0} 个<br/>面积 ${Math.round(p.data?.area || 0).toLocaleString()} ㎡`,
        },
      },
      {
        type: 'scatter',
        coordinateSystem: 'geo',
        data: props.points.map((p) => ({ name: p.label, value: [...p.lnglat, p.count], sub: p.sub })),
        symbolSize: (v) => Math.min(22, 8 + Math.sqrt(v[2]) * 4),
        itemStyle: { color: c.dot, borderColor: c.dotBorder, borderWidth: 1.5, borderType: 'dashed' },
        tooltip: { formatter: (p) => [p.name, ...(p.data.sub || []), '位置：区县中心（近似）'].join('<br/>') },
        zlevel: 2,
      },
    ],
  }
})
</script>
