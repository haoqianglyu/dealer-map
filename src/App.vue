<template>
  <!-- 地图页常驻（keep-alive）：从项目详情返回时保留原地图视图/筛选/告警状态；
       按 path 作 key，详情页之间切换（/project/a → /project/b）会重新挂载 -->
  <router-view v-slot="{ Component, route }">
    <keep-alive include="DealerMap">
      <component :is="Component" :key="route.path" />
    </keep-alive>
  </router-view>
</template>
