<template>
  <div ref="root" class="ss" :class="{ open }" :style="{ width: `${width}px` }" @keydown="onKey">
    <button ref="btn" type="button" class="ss__btn" aria-haspopup="listbox" :aria-expanded="open" :aria-label="label" @click="open ? close() : show()">
      <span class="ss__val">{{ current?.label ?? placeholder }}</span>
      <svg class="ss__arrow" viewBox="0 0 1024 1024" width="12" height="12" aria-hidden="true">
        <path fill="currentColor" d="M831.872 340.864 512 652.672 192.128 340.864a30.592 30.592 0 0 0-42.752 0 29.12 29.12 0 0 0 0 41.6L489.664 714.24a32 32 0 0 0 44.672 0l340.288-331.712a29.12 29.12 0 0 0 0-41.728 30.592 30.592 0 0 0-42.752 0z" />
      </svg>
    </button>
    <ul v-if="open" ref="list" class="ss__list" role="listbox" tabindex="-1" :aria-activedescendant="`ss-${uid}-${active}`">
      <li
        v-for="(o, i) in options"
        :id="`ss-${uid}-${i}`"
        :key="o.value"
        role="option"
        :aria-selected="o.value === modelValue"
        :class="{ sel: o.value === modelValue, hover: i === active }"
        @mouseenter="active = i"
        @click="pick(o)"
      >
        {{ o.label }}
      </li>
    </ul>
  </div>
</template>

<script setup>
// 小号下拉（对应 niuniu 的 el-select size="small" + dark-select-popper）：
// 触发框 24px 高 / 12px 字 / 细边框 + 右侧箭头；弹层与触发框同宽、贴在下方，选项 28px 高，最多约 8 项后滚动。
// 键盘：↑↓ 移动、Enter 选择、Esc 关闭；点外部关闭。
import { ref, computed, nextTick, onMounted, onBeforeUnmount } from 'vue'

const props = defineProps({
  modelValue: { type: [String, Number], default: '' },
  options: { type: Array, default: () => [] }, // [{ value, label }]
  width: { type: Number, default: 120 },
  label: { type: String, default: '' },
  placeholder: { type: String, default: '请选择' },
})
const emit = defineEmits(['update:modelValue'])
const uid = Math.random().toString(36).slice(2, 7)
const root = ref(null)
const btn = ref(null)
const list = ref(null)
const open = ref(false)
const active = ref(0)
const current = computed(() => props.options.find((o) => o.value === props.modelValue))

async function show() {
  open.value = true
  active.value = Math.max(0, props.options.findIndex((o) => o.value === props.modelValue))
  await nextTick()
  list.value?.focus()
  list.value?.querySelector('.hover')?.scrollIntoView({ block: 'nearest' })
}
function close(refocus = true) {
  open.value = false
  if (refocus) btn.value?.focus()
}
function pick(o) {
  emit('update:modelValue', o.value)
  close()
}
function onKey(e) {
  if (!open.value) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      show()
    }
    return
  }
  if (e.key === 'Escape') {
    e.preventDefault()
    close()
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    active.value = Math.min(props.options.length - 1, Math.max(0, active.value + (e.key === 'ArrowDown' ? 1 : -1)))
    nextTick(() => list.value?.querySelector('.hover')?.scrollIntoView({ block: 'nearest' }))
  } else if (e.key === 'Enter') {
    e.preventDefault()
    const o = props.options[active.value]
    if (o) pick(o)
  } else if (e.key === 'Tab') close(false)
}
const onDoc = (e) => {
  if (open.value && root.value && !root.value.contains(e.target)) close(false)
}
onMounted(() => document.addEventListener('pointerdown', onDoc))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDoc))
</script>

<style scoped>
.ss {
  position: relative;
  font-size: 12px;
}
.ss__btn {
  display: flex;
  align-items: center;
  width: 100%;
  height: 24px;
  padding: 0 8px;
  font: inherit;
  font-size: 12px;
  color: var(--dm-text-muted, #93b5d6);
  background: var(--dm-input-bg, rgba(7, 22, 48, 0.85));
  border: 0;
  border-radius: 4px;
  box-shadow: 0 0 0 1px var(--dm-panel-border, rgba(0, 212, 255, 0.28)) inset;
  cursor: pointer;
}
.ss__btn:hover,
.ss.open .ss__btn,
.ss__btn:focus-visible {
  outline: none;
  box-shadow: 0 0 0 1px var(--dm-accent, #00d4ff) inset;
}
.ss__val {
  flex: 1;
  overflow: hidden;
  text-align: left;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.ss__arrow {
  flex-shrink: 0;
  margin-left: 4px;
  transition: transform 0.2s;
}
.ss.open .ss__arrow {
  transform: rotate(180deg);
}
.ss__list {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 50;
  width: 100%;
  max-height: 232px; /* 8 项 × 28px + 内边距 */
  margin: 0;
  padding: 4px 0;
  overflow-y: auto;
  list-style: none;
  background: var(--dm-popover-bg, rgba(7, 22, 48, 0.96));
  border: 1px solid var(--dm-panel-border, rgba(0, 212, 255, 0.28));
  border-radius: 4px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
}
.ss__list:focus-visible {
  outline: none;
}
.ss__list li {
  height: 28px;
  padding: 0 10px;
  overflow: hidden;
  line-height: 28px;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--dm-text-muted, #93b5d6);
  cursor: pointer;
}
.ss__list li.hover {
  color: #fff;
  background: rgba(0, 212, 255, 0.18);
}
.ss__list li.sel {
  font-weight: bold;
  color: var(--dm-accent, #00d4ff);
  background: rgba(0, 212, 255, 0.08);
}
</style>
