#!/usr/bin/env bash
# 冒烟测试：标记可点击（区县汇总气泡 → 放大；小区标记 → 弹窗）。需已登录的 agent-browser 会话停在 #/dealer-map。
# 用法：tests/marker-click.sh   （退出码 0 = 通过）
set -u
ab() { agent-browser "$@"; }
hit=$(ab eval 'JSON.stringify((()=>{const m=document.querySelector(".dm-mk--district")||document.querySelector(".dm-mk");if(!m)return "none";const r=m.getBoundingClientRect();const el=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return m.contains(el)?"ok":"blocked by "+el.tagName})())')
echo "district hit-test: $hit"
case "$hit" in *ok*) ;; *) exit 1;; esac
ab click '.dm-mk--district' >/dev/null 2>&1; sleep 2
# 放大后应出现小区级标记
n=$(ab eval 'document.querySelectorAll(".dm-mk:not(.dm-mk--district)").length')
echo "community markers after zoom: $n"
[ "${n//\"/}" -gt 0 ] || exit 1
ab click '.dm-mk:not(.dm-mk--district)' >/dev/null 2>&1; sleep 1
pop=$(ab eval 'document.querySelector(".dm-pop") ? 1 : 0')
echo "popover open: $pop"
[ "${pop//\"/}" = "1" ] || exit 1
echo PASS
