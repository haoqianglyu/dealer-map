<template>
  <!-- 地图页常驻（keep-alive）：从项目详情返回时保留原地图视图/筛选/告警状态 -->
  <router-view v-slot="{ Component }">
    <keep-alive include="DealerMap">
      <component :is="Component" />
    </keep-alive>
  </router-view>
</template>
