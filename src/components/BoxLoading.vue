<template>
  <div v-if="show" class="bl" role="status" aria-live="polite">
    <svg class="bl__ring" viewBox="0 0 50 50" aria-hidden="true"><circle cx="25" cy="25" r="20" fill="none" /></svg>
    <span class="bl__text">{{ text }}</span>
  </div>
</template>

<script setup>
// 面板内加载遮罩（对应 niuniu 的 element-plus v-loading：透明底 + 旋转圆环 + 「加载中...」，居中于所在面板）
defineProps({
  show: { type: Boolean, default: false },
  text: { type: String, default: '加载中...' },
})
</script>

<style scoped>
.bl {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: transparent;
  pointer-events: none;
}
.bl__ring {
  width: 42px;
  height: 42px;
  animation: bl-rotate 2s linear infinite;
}
.bl__ring circle {
  stroke: var(--dm-accent, #00d4ff);
  stroke-width: 2;
  stroke-linecap: round;
  stroke-dasharray: 90, 150;
  stroke-dashoffset: 0;
  animation: bl-dash 1.5s ease-in-out infinite;
}
.bl__text {
  margin: 3px 0;
  font-size: 14px;
  font-weight: bold;
  letter-spacing: 1px;
  color: var(--dm-accent, #00d4ff);
}
@keyframes bl-rotate {
  to {
    transform: rotate(360deg);
  }
}
@keyframes bl-dash {
  0% {
    stroke-dasharray: 1, 200;
    stroke-dashoffset: 0;
  }
  50% {
    stroke-dasharray: 90, 150;
    stroke-dashoffset: -40px;
  }
  100% {
    stroke-dasharray: 90, 150;
    stroke-dashoffset: -120px;
  }
}
</style>
