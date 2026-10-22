<template>
  <span class="brand-logo">
    <img v-if="brand" :src="brand.logo" :alt="brand.name" :height="height" />
    <span v-else class="brand-logo__text">{{ name }}</span>
  </span>
</template>

<script setup>
import { computed } from 'vue'
import { brandFor } from '@/config/brand'

const props = defineProps({
  name: { type: String, default: '' }, // 经销商名称（用于匹配 logo；无 logo 时显示文字）
  height: { type: Number, default: 38 },
})
const brand = computed(() => brandFor(props.name))
</script>

<style scoped>
.brand-logo {
  display: inline-flex;
  align-items: center;
}
.brand-logo img {
  display: block;
  width: auto;
  /* 深色主题：深灰原图 → 白色；浅色主题设 --dm-logo-filter: none */
  filter: var(--dm-logo-filter, brightness(0) invert(1));
  opacity: var(--dm-logo-opacity, 0.92);
}
.brand-logo__text {
  font-size: 24px;
  font-weight: 700;
  letter-spacing: 3px;
  color: #fff;
}
:root[data-theme='light'] .brand-logo__text {
  color: var(--dm-text);
}
</style>
