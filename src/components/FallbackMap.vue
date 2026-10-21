<template>
  <EChart :option="option" />
</template>

<script setup>
import { computed } from 'vue'
import * as echarts from 'echarts'
import EChart from './EChart.vue'
import { tooltipStyle } from '@/utils/chartTheme'

// 无高德 Key（或高德加载失败）时的兜底：本市区县轮廓 + 各区项目数（单色由浅到深）+ 小区近似点
const props = defineProps({
  geojson: { type: Object, default: null },
  mapName: { type: String, default: '' },
  districtStats: { type: Array, default: () => [] }, // [{ name, count, area }]
  points: { type: Array, default: () => [] },
})

const option = computed(() => {
  if (!props.geojson || !props.mapName) return {}
  if (!echarts.getMap(props.mapName)) echarts.registerMap(props.mapName, props.geojson)
  const max = Math.max(1, ...props.districtStats.map((d) => d.count))
  return {
    tooltip: { ...tooltipStyle, trigger: 'item' },
    visualMap: {
      show: false,
      min: 0,
      max,
      seriesIndex: 0,
      inRange: { color: ['#0b2447', '#124a8c', '#1b77c9', '#20b3e8'] },
    },
    geo: {
      map: props.mapName,
      roam: true,
      layoutCenter: ['40%', '54%'],
      layoutSize: '86%',
      label: { show: true, color: '#b7d3f0', fontSize: 13 },
      itemStyle: { areaColor: '#0b2447', borderColor: 'rgba(0, 212, 255, 0.55)', borderWidth: 1.2 },
      emphasis: { label: { color: '#fff' }, itemStyle: { areaColor: '#1d5fae' } },
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
        itemStyle: { color: 'rgba(255, 199, 34, 0.15)', borderColor: '#ffc722', borderWidth: 1.5, borderType: 'dashed' },
        tooltip: { formatter: (p) => [p.name, ...(p.data.sub || []), '位置：区县中心（近似）'].join('<br/>') },
        zlevel: 2,
      },
    ],
  }
})
</script>
