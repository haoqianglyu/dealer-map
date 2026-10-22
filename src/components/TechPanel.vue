<template>
  <section class="tech-panel">
    <header v-if="title || $slots.title" class="panel-title">
      <span class="title-bar" />
      <span class="title-text"><slot name="title">{{ title }}</slot></span>
      <span class="title-extra"><slot name="extra" /></span>
    </header>
    <div class="panel-body" :class="{ 'no-title': !title && !$slots.title }">
      <div v-if="loading" class="panel-skel" aria-label="加载中">
        <i /><i /><i />
      </div>
      <slot v-else />
    </div>
  </section>
</template>

<script setup>
// 地图页面板：平面玻璃（1px 细边 + 模糊），唯一装饰是标题前的 3×14 竖条；加载时显示骨架条
defineProps({
  title: { type: String, default: '' },
  loading: { type: Boolean, default: false },
})
</script>

<style scoped lang="scss">
/* 亮色：面板靠阴影分层（docs/fable-light-theme.md §4）；深色不变 */
:root[data-theme='light'] {
  .tech-panel {
    box-shadow: var(--dm-shadow);
  }
  .panel-skel i {
    background-image: linear-gradient(90deg, rgba(16, 33, 58, 0.06), rgba(16, 33, 58, 0.12), rgba(16, 33, 58, 0.06));
  }
}
.tech-panel {
  position: relative;
  display: flex;
  flex-direction: column;
  background: var(--dm-panel);
  border: 1px solid var(--dm-line);
  border-radius: 10px;
  backdrop-filter: blur(12px);
}
.panel-title {
  flex: none;
  display: flex;
  align-items: center;
  height: 44px;
  padding: 0 12px 0 16px;
  .title-bar {
    flex: none;
    width: 3px;
    height: 14px;
    margin-right: 8px;
    background: var(--dm-accent);
    border-radius: 2px;
  }
  .title-text {
    display: flex;
    align-items: center;
    min-width: 0;
    font-size: 16px;
    font-weight: 600;
    color: var(--dm-text);
    white-space: nowrap;
  }
  .title-extra {
    margin-left: auto;
    display: flex;
    align-items: center;
  }
}
.panel-body {
  flex: 1;
  min-height: 0;
  position: relative;
  overflow: hidden;
  &.no-title {
    padding-top: 6px;
  }
}
.panel-skel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 8px 16px;
  i {
    display: block;
    height: 12px;
    border-radius: 4px;
    background: linear-gradient(90deg, rgba(120, 170, 255, 0.08), rgba(120, 170, 255, 0.16), rgba(120, 170, 255, 0.08)) 0 0 / 200% 100%;
    animation: shimmer 1.2s linear infinite;
    &:nth-child(2) {
      width: 80%;
    }
    &:nth-child(3) {
      width: 60%;
    }
  }
}
@keyframes shimmer {
  to {
    background-position: -200% 0;
  }
}
</style>
