// 回归：60 s 轮询（告警 / 在线）只能增量更新标记内容与弹窗内容，绝不能改视野（缩放 / 中心 / 适配 / 避让平移 / 重新 open）。
// AmapView 是 SFC，这里静态检查数据刷新路径上的函数体；真机验证见 tests/poll-view.sh。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const src = fs.readFileSync(new URL('../src/components/AmapView.vue', import.meta.url), 'utf8')
const body = (name) => {
  const i = src.indexOf(`function ${name}(`)
  assert.ok(i >= 0, `${name} 不存在`)
  let depth = 0
  for (let j = src.indexOf('{', i); j < src.length; j++) {
    if (src[j] === '{') depth++
    else if (src[j] === '}' && --depth === 0) return src.slice(i, j + 1)
  }
}
const VIEW = /setZoom|setZoomAndCenter|setCenter|panBy|panTo|setBounds|setFitView|fitBounds|zoomTo|zoomInto|centerOn|quickPan|avoidUi|openPopover|info\.open|focusCommunity|onZoom\(/

test('数据刷新路径不触碰视野', () => {
  const w = src.indexOf('() => [props.communities, props.districts, props.cityLabels]')
  assert.ok(w > 0)
  const cb = src.slice(w, src.indexOf('\n)', w))
  assert.doesNotMatch(cb, VIEW)
  for (const f of ['refreshPopover', 'updatePopover', 'rebuildIndexes', 'syncMarkers', 'renderHeat', 'groupContent']) assert.doesNotMatch(body(f), VIEW, f)
  // renderMarkers 只在点按回调（tap: () => …）里缩放；去掉这些闭包后不应再有视野调用
  assert.doesNotMatch(body('renderMarkers').replace(/tap: \(\) => \{[\s\S]*?\n {8}\},|tap: \(\) => onItemTap\(it\)/g, ''), VIEW)
  assert.doesNotMatch(body('render'), VIEW)
})

test('DealerMap：只有切换城市 / 首次加载会适配视野，轮询函数不碰 fit / focus', () => {
  const dm = fs.readFileSync(new URL('../src/views/DealerMap.vue', import.meta.url), 'utf8')
  for (const name of ['loadAlarms', 'loadOnline', 'refreshStatus']) {
    const i = dm.indexOf(`function ${name}(`)
    const seg = dm.slice(i, dm.indexOf('\n}', i))
    assert.doesNotMatch(seg, /fit\.value|focus\.value|fitCity|loadProjects/, name)
  }
})
