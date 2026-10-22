<template>
  <!-- 地图页常驻（keep-alive）：从项目详情返回时保留原地图视图/筛选/告警状态；
       按 path 作 key，详情页之间切换（/project/a → /project/b）会重新挂载。
       登录 → 地图：250 ms 交叉淡化（登录页在上淡出，地图页的灯光加载罩在下，同一片灯光接上）；其它路由切换不加过渡 -->
  <router-view v-slot="{ Component, route }">
    <transition :name="xfade" :css="Boolean(xfade)">
      <keep-alive include="DealerMap">
        <component :is="Component" :key="route.path" />
      </keep-alive>
    </transition>
  </router-view>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'

const xfade = ref('')
useRouter().beforeEach((to, from) => {
  xfade.value = from.path === '/login' && to.path !== '/login' && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'xfade' : ''
})
</script>

<style>
.xfade-leave-active {
  position: fixed !important;
  inset: 0;
  z-index: 100;
  pointer-events: none;
  transition: opacity 0.25s ease;
}
.xfade-leave-to {
  opacity: 0;
}
</style>
