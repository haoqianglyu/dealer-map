<template>
  <div ref="el" class="echart" />
</template>

<script setup>
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import * as echarts from 'echarts'
import { uiScale } from '@/composables/useScreenScale'

const props = defineProps({ option: { type: Object, required: true } })
const emit = defineEmits(['ready'])
const el = ref(null)
let chart = null
let ro = null

onMounted(() => {
  // 外层按 uiScale 缩放：画布分辨率随之提高，放大时不发虚
  chart = echarts.init(el.value, null, { devicePixelRatio: (window.devicePixelRatio || 1) * Math.max(1, uiScale.value) })
  chart.setOption(props.option)
  ro = new ResizeObserver(() => chart && chart.resize())
  ro.observe(el.value)
  emit('ready', chart)
})
watch(
  () => props.option,
  (o) => chart && chart.setOption(o, true)
)
onBeforeUnmount(() => {
  ro && ro.disconnect()
  chart && chart.dispose()
  chart = null
})
</script>

<style scoped>
.echart {
  width: 100%;
  height: 100%;
}
</style>
