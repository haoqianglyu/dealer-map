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
pop=$(ab eval '[...document.querySelectorAll(".dm-pop")].some(p=>p.offsetParent) ? 1 : 0')
echo "popover open: $pop"
[ "${pop//\"/}" = "1" ] || exit 1
echo PASS-BASIC

# 3) 进行中告警的小区：经告警列表飞到该小区 → 关闭弹窗 → 直接点红色标记 → 弹窗里应有告警行（时间/设备/内容）
ab eval '[...document.querySelectorAll(".list.alarms li.on:not(.off)")].find(l=>l.innerText.includes("金科蠡湖"))?.click() || document.querySelector(".list.alarms li.on:not(.off)")?.click(); 1' >/dev/null; sleep 2
# 关弹窗：在地图空白处真实点击一次（找一个不在标记/弹窗/面板上的点）
pt=$(ab eval 'JSON.stringify((()=>{for(let y=200;y<900;y+=37)for(let x=100;x<1300;x+=41){const el=document.elementFromPoint(x,y);if(el&&el.closest(".amap")&&!el.closest(".dm-mk")&&!el.closest(".dm-pop")&&!el.closest(".amap-marker"))return [x,y]}return null})())' | tr -d '"\\[]')
ab mouse move ${pt%,*} ${pt#*,} >/dev/null; ab mouse down >/dev/null; ab mouse up >/dev/null; sleep 1
closed=$(ab eval '[...document.querySelectorAll(".dm-pop")].some(p=>p.offsetParent) ? 0 : 1' | tr -d '"')
echo "popover closed: $closed"
[ "$closed" = "1" ] || exit 1
red=$(ab eval 'JSON.stringify((()=>{for(const m of document.querySelectorAll(".dm-mk--alarm:not(.dm-mk--district)")){const r=m.getBoundingClientRect();const x=r.x+r.width/2,y=r.y+r.height/2;if(m.contains(document.elementFromPoint(x,y)))return [Math.round(x),Math.round(y)]}return null})())' | tr -d '"\\[]')
echo "red marker at: $red"
[ -n "$red" ] && [ "$red" != "null" ] || exit 1
ab mouse move ${red%,*} ${red#*,} >/dev/null; ab mouse down >/dev/null; ab mouse up >/dev/null; sleep 1
rows=$(ab eval 'JSON.stringify([...document.querySelectorAll(".dm-pop li.al")].filter(l=>l.offsetParent).slice(0,3).map(l=>l.innerText.replace(/\s+/g," ")))')
echo "alarm rows: $rows"
case "$rows" in *级*) echo PASS-ALARM ;; *) exit 1;; esac
