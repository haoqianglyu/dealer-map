<template>
  <div ref="root" class="cp" :class="[{ open }, `cp--${variant}`]" @keydown="onKey">
    <button
      ref="btn"
      type="button"
      class="cp__btn"
      aria-haspopup="listbox"
      :aria-expanded="open"
      :aria-label="`${label}：${current.label}`"
      @click="toggle"
    >
      <span class="cp__val">{{ current.label }}</span>
      <i class="cp__caret" />
    </button>
    <div v-if="open" class="cp__panel">
      <input
        v-if="options.length > 10 && expanded"
        ref="filterEl"
        v-model="q"
        class="cp__filter"
        type="text"
        placeholder="筛选城市"
        aria-label="筛选城市"
      />
      <ul ref="listEl" class="cp__list" role="listbox" :aria-activedescendant="`cp-opt-${active}`" tabindex="-1">
        <li
          v-for="(o, i) in shown"
          :id="`cp-opt-${i}`"
          :key="o.value || '_all'"
          role="option"
          :aria-selected="o.value === modelValue"
          :class="{ sel: o.value === modelValue, act: i === active }"
          @mouseenter="active = i"
          @click="pick(o)"
        >
          <span class="cp__name">{{ o.label }}</span>
          <span v-if="o.count != null" class="cp__bar"><b :style="{ width: `${(o.count / max) * 100}%` }" /></span>
          <span v-if="o.count != null" class="cp__n">{{ o.count }}</span>
        </li>
        <li v-if="hiddenCount" class="cp__more" @click.stop="expanded = true">更多{{ label }}（{{ hiddenCount }}）▾</li>
        <li v-if="!shown.length" class="cp__empty">无匹配{{ label }}</li>
      </ul>
    </div>
  </div>
</template>

<script setup>
// 大屏风格的城市下拉（替代原生 select）：玻璃面板 + 细青色边框 + 角标；颜色走 CSS 变量（主题 token），
// 键盘：↑↓ 移动、Enter 选择、Esc 关闭；点外部关闭；城市多时顶部可筛选。
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'

const props = defineProps({
  modelValue: { type: String, default: '' },
  options: { type: Array, default: () => [] }, // [{ value, label, count }]，第一项为「全部」
  label: { type: String, default: '城市' },
  variant: { type: String, default: 'box' }, // box：普通下拉框 | title：顶栏标题样式（20px 粗体，无边框）
})
const TOP = 5 // 「全部」+ 数量前 4 名置顶，其余折叠为「更多」
const expanded = ref(false)
const emit = defineEmits(['update:modelValue'])

const root = ref(null)
const btn = ref(null)
const listEl = ref(null)
const filterEl = ref(null)
const open = ref(false)
const q = ref('')
const active = ref(0)

const current = computed(() => props.options.find((o) => o.value === props.modelValue) || props.options[0] || { label: '—' })
const shown = computed(() => {
  const k = q.value.trim()
  if (k) return props.options.filter((o) => o.label.includes(k))
  if (expanded.value || props.options.length <= TOP + 1) return props.options
  const top = props.options.slice(0, TOP)
  const sel = props.options.find((o) => o.value === props.modelValue)
  return sel && !top.includes(sel) ? [...top, sel] : top
})
const hiddenCount = computed(() => (q.value.trim() ? 0 : props.options.length - shown.value.length))
const max = computed(() => Math.max(1, ...props.options.map((o) => o.count || 0)))

function toggle() {
  open.value ? close() : show()
}
async function show() {
  open.value = true
  q.value = ''
  expanded.value = false
  active.value = Math.max(0, shown.value.findIndex((o) => o.value === props.modelValue))
  await nextTick()
  ;(filterEl.value || listEl.value)?.focus()
  scrollActive()
}
function close(refocus = true) {
  open.value = false
  if (refocus) btn.value?.focus()
}
function pick(o) {
  emit('update:modelValue', o.value)
  close()
}
function scrollActive() {
  nextTick(() => listEl.value?.querySelector('.act')?.scrollIntoView({ block: 'nearest' }))
}
function onKey(e) {
  if (!open.value) {
    if (['ArrowDown', 'ArrowUp'].includes(e.key)) {
      e.preventDefault()
      show()
    }
    return
  }
  if (e.key === 'Escape') {
    e.preventDefault()
    close()
  } else if (e.key === 'ArrowDown') {
    e.preventDefault()
    if (active.value >= shown.value.length - 1 && hiddenCount.value) expanded.value = true // 到底自动展开「更多」
    active.value = Math.min(shown.value.length - 1, active.value + 1)
    scrollActive()
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    active.value = Math.max(0, active.value - 1)
    scrollActive()
  } else if (e.key === 'Enter') {
    e.preventDefault()
    const o = shown.value[active.value]
    if (o) pick(o)
  } else if (e.key === 'Tab') {
    close(false)
  }
}
watch(q, () => (active.value = 0))
const onDoc = (e) => {
  if (open.value && root.value && !root.value.contains(e.target)) close(false)
}
onMounted(() => document.addEventListener('pointerdown', onDoc))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDoc))
</script>

<style scoped lang="scss">
.cp {
  --cp-bg: var(--dm-panel-bg, rgba(6, 18, 40, 0.92));
  --cp-border: var(--dm-accent-line, rgba(0, 212, 255, 0.45));
  --cp-accent: var(--dm-accent, #00d4ff);
  --cp-text: var(--dm-text, #d8ecff);
  --cp-muted: var(--dm-text-muted, #93b5d6);
  --cp-hover: var(--dm-hover, rgba(0, 212, 255, 0.1));
  position: relative;
  display: inline-block;
}
.cp__btn {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 140px;
  height: 40px; /* 点按目标 ≥ 40px（电视） */
  padding: 0 10px;
  font: inherit;
  font-size: 13px;
  color: var(--cp-text);
  background: var(--cp-bg);
  border: 1px solid var(--cp-border);
  border-radius: 4px;
  cursor: pointer;
  &:hover {
    border-color: var(--cp-accent);
  }
  &:focus-visible {
    outline: 2px solid var(--cp-accent);
    outline-offset: 2px;
  }
}
.cp__val {
  flex: 1;
  text-align: left;
  white-space: nowrap;
}
.cp__caret {
  width: 0;
  height: 0;
  border-left: 4px solid transparent;
  border-right: 4px solid transparent;
  border-top: 5px solid var(--cp-accent);
  transition: transform 0.15s;
}
.open .cp__caret {
  transform: rotate(180deg);
}
.cp__panel {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 50;
  width: 280px;
  padding: 6px 0;
  background: var(--cp-bg);
  border: 1px solid var(--cp-border);
  border-radius: 10px;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.45), 0 0 14px rgba(0, 212, 255, 0.15);
  backdrop-filter: blur(6px);
}
.cp__corner {
  position: absolute;
  width: 10px;
  height: 10px;
  border-color: var(--cp-accent);
  border-style: solid;
  border-width: 0;
  &.tl {
    top: -1px;
    left: -1px;
    border-top-width: 2px;
    border-left-width: 2px;
  }
  &.tr {
    top: -1px;
    right: -1px;
    border-top-width: 2px;
    border-right-width: 2px;
  }
  &.bl {
    bottom: -1px;
    left: -1px;
    border-bottom-width: 2px;
    border-left-width: 2px;
  }
  &.br {
    bottom: -1px;
    right: -1px;
    border-bottom-width: 2px;
    border-right-width: 2px;
  }
}
.cp__filter {
  display: block;
  width: calc(100% - 20px);
  margin: 0 10px 6px;
  padding: 4px 8px;
  font: inherit;
  font-size: 12px;
  color: var(--cp-text);
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid var(--cp-border);
  border-radius: 3px;
  &:focus-visible {
    outline: 2px solid var(--cp-accent);
    outline-offset: 1px;
  }
}
.cp__list {
  max-height: 340px;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  list-style: none;
  &:focus-visible {
    outline: none;
  }
  li {
    display: grid;
    grid-template-columns: 1fr 70px 34px;
    align-items: center;
    gap: 8px;
    height: 40px;
    padding: 0 14px;
    font-size: 13px;
    color: var(--cp-text);
    cursor: pointer;
    border-left: 2px solid transparent;
    &.act {
      background: var(--cp-hover);
    }
    &.sel {
      color: #fff;
      border-left-color: var(--cp-accent);
      .cp__name {
        font-weight: 600;
      }
    }
  }
}
.cp:focus-within .cp__list li.act {
  outline: 1px solid rgba(0, 212, 255, 0.5);
  outline-offset: -1px;
}
.cp__bar {
  height: 4px;
  background: rgba(0, 212, 255, 0.12);
  border-radius: 2px;
  b {
    display: block;
    height: 100%;
    background: rgba(53, 212, 255, 0.35);
    border-radius: 2px;
  }
}
.cp__n {
  text-align: right;
  font-family: 'DIN Alternate', 'Bahnschrift', monospace;
  color: var(--cp-muted);
}
.cp__list li.sel .cp__bar b {
  background: var(--cp-accent);
}
.cp__list li.cp__more {
  display: flex;
  color: var(--cp-accent);
  font-size: 12px;
}
.cp--title {
  .cp__btn {
    min-width: 0;
    height: 40px;
    padding: 0 8px;
    gap: 10px;
    font-size: 20px;
    font-weight: 600;
    color: var(--dm-text, #f2f7ff);
    background: transparent;
    border-color: transparent;
    border-radius: 8px;
    &:hover {
      background: rgba(255, 255, 255, 0.06);
      border-color: transparent;
    }
  }
  .cp__caret {
    border-top-color: var(--cp-muted);
  }
  .cp__panel {
    left: 0;
    right: auto;
  }
}
.cp__empty {
  justify-content: center;
  color: var(--cp-muted);
  cursor: default;
}
</style>
