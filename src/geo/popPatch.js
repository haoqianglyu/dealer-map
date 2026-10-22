// 弹窗增量更新（60 s 轮询）：按行比较上一次与这一次的 HTML，只换变了的行，不变的行（含焦点 / 跑马灯 / 展开态）原样保留。
// → [{ op: 'replace' | 'append' | 'remove', i }]（remove 从后往前给出，依次执行即可）
export function rowPatch(prev, next) {
  const ops = []
  for (let i = 0; i < Math.min(prev.length, next.length); i++) if (prev[i] !== next[i]) ops.push({ op: 'replace', i })
  for (let i = prev.length; i < next.length; i++) ops.push({ op: 'append', i })
  for (let i = prev.length - 1; i >= next.length; i--) ops.push({ op: 'remove', i })
  return ops
}
// 焦点元素的身份（遥控 / 键盘焦点在被替换的行里时，换完在弹窗里找回同一个按钮）：只用稳定的 data-* 与「详情」按钮标记，
// 不含随状态变化的 class（告警恢复后摘要行去掉 on，仍是同一个按钮）
export const focusKey = (n) =>
  n ? ['data-act', 'data-pid', 'data-g'].map((a) => n.getAttribute?.(a) || '').join('|') + (/(^|\s)go(\s|$)/.test(n.className || '') ? '|go' : '') : ''
