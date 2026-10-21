<template>
  <component
    :is="borderComp"
    class="tech-panel"
    :background-color="backgroundColor"
  >
    <div class="panel-inner">
      <div v-if="title" class="panel-title">
        <span class="title-bar" />
        <span class="title-text">{{ title }}</span>
        <span class="title-tail" />
      </div>
      <div class="panel-body" :class="{ 'no-title': !title }">
        <slot />
      </div>
      <div v-if="loading" class="panel-loading">
        <span class="loading-ring" />
        <span class="loading-text">数据加载中...</span>
      </div>
    </div>
  </component>
</template>

<script setup>
import { computed } from 'vue'
// DataV 边框（Vue3 版），与老版 dv-border-box-* 一一对应
import { BorderBox9, BorderBox10, BorderBox12, BorderBox13 } from '@kjgl77/datav-vue3'

const props = defineProps({
  title: { type: String, default: '' },
  loading: { type: Boolean, default: false },
  // 边框样式：9 / 10 / 12 / 13，对应老版各版块的 dv-border-box 编号
  variant: { type: String, default: '13' },
  backgroundColor: { type: String, default: 'rgba(3, 12, 30, 0.5)' },
})

const BORDER_MAP = {
  9: BorderBox9,
  10: BorderBox10,
  12: BorderBox12,
  13: BorderBox13,
}

const borderComp = computed(() => BORDER_MAP[props.variant] || BorderBox13)
</script>

<style scoped lang="scss">
.tech-panel {
  width: 100%;
  height: 100%;
}

.panel-inner {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.panel-title {
  flex: none;
  display: flex;
  align-items: center;
  height: 38px;
  margin-top: 12px;
  padding: 0 20px;

  .title-bar {
    width: 4px;
    height: 16px;
    margin-right: 8px;
    background: linear-gradient(180deg, #00d4ff, #1b62d8);
    border-radius: 2px;
    box-shadow: 0 0 6px rgba(0, 212, 255, 0.9);
  }

  .title-text {
    font-size: 16px;
    font-weight: 600;
    letter-spacing: 1px;
    background: linear-gradient(180deg, #ffffff, #7ec7ff);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }

  .title-tail {
    flex: 1;
    height: 1px;
    margin-left: 12px;
    background: linear-gradient(90deg, rgba(0, 212, 255, 0.4), transparent);
  }
}

.panel-body {
  flex: 1;
  min-height: 0;
  position: relative;

  &.no-title {
    padding-top: 6px;
  }
}

.panel-loading {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  background: rgba(4, 10, 24, 0.55);

  .loading-ring {
    width: 26px;
    height: 26px;
    border: 2px solid rgba(0, 212, 255, 0.25);
    border-top-color: #00d4ff;
    border-radius: 50%;
    animation: spin 0.9s linear infinite;
  }

  .loading-text {
    font-size: 12px;
    color: #7ec7ff;
    letter-spacing: 2px;
  }
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
