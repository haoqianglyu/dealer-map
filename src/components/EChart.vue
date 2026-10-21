<template>
  <div ref="el" class="echart" />
</template>

<script setup>
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import * as echarts from 'echarts'

const props = defineProps({ option: { type: Object, required: true } })
const emit = defineEmits(['ready'])
const el = ref(null)
let chart = null
let ro = null

onMounted(() => {
  chart = echarts.init(el.value)
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
