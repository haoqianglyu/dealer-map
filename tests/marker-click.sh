#!/usr/bin/env bash
# 冒烟测试：标记可点击（区县汇总气泡 → 放大到街区簇级；簇 → 再放大；小区标记 → 弹窗）。需已登录的 agent-browser 会话停在 #/dealer-map。
# 用法：tests/marker-click.sh   （退出码 0 = 通过）
set -u
ab() { agent-browser "$@"; }
# 从干净的地图页开始（整页刷新，回到默认缩放）
ab eval 'location.hash="#/dealer-map"; location.reload(); 1' >/dev/null; sleep 4
for i in $(seq 1 30); do [ "$(ab eval 'document.querySelectorAll(".dm-mk").length > 0 ? 1 : 0' | tr -d '"')" = "1" ] && break; sleep 2; done; sleep 3
# 真人点击：按下 → 抖动几像素 → 抬起（鼠标 / 触控板 / 手指 / 遥控都会抖）。高德 Marker 'click' 在移动 ≥ ~3px 时会被吞掉，
# 合成的「原地按下抬起」测不出来——这里故意抖 ~4px（+3,+2）。
tap() { local x=${1%,*} y=${1#*,}; ab mouse move "$x" "$y" >/dev/null; ab mouse down >/dev/null; ab mouse move $((x+3)) $((y+2)) >/dev/null; ab mouse up >/dev/null; }
# 可见且未被遮挡的标记中心（优先指定名字）
mkxy() { ab eval "JSON.stringify((()=>{const ms=[...document.querySelectorAll('$1')].sort((a,b)=>(b.innerText.includes('$2'))-(a.innerText.includes('$2')));for(const m of ms){const r=m.getBoundingClientRect();const x=Math.round(r.x+r.width/2),y=Math.round(r.y+r.height/2);if(m.contains(document.elementFromPoint(x,y)))return [x,y]}return null})())" | tr -d '"\\[]'; }
scale() { ab eval 'document.querySelector(".amap-scale-text")?.innerText' | tr -d '"'; }
d=$(mkxy '.dm-mk--district' 滨湖区)
echo "district bubble at: $d"
[ -n "$d" ] && [ "$d" != "null" ] || exit 1
s0=$(scale)
tap "$d"; sleep 2
# 放大到该区的小区级：区县气泡消失、出现小区标记、比例尺变小
n=$(ab eval 'document.querySelectorAll(".dm-mk:not(.dm-mk--district)").length' | tr -d '"')
nd=$(ab eval 'document.querySelectorAll(".dm-mk--district").length' | tr -d '"')
s1=$(scale)
echo "after district tap: scale $s0 → $s1, district bubbles $nd, community markers $n"
[ "$n" -gt 0 ] && [ "$nd" = "0" ] && [ "$s1" != "$s0" ] || exit 1
# 2) 落到街区簇级：应有多小区簇（叠环）且不写地名；点簇（同样抖动）→ 放大到刚好拆开的级别
nc=$(ab eval 'document.querySelectorAll(".dm-mk--cluster").length' | tr -d '"')
named=$(ab eval 'document.querySelectorAll(".dm-mk--named").length' | tr -d '"')
echo "cluster level: clusters $nc, named capsules $named"
[ "$nc" -gt 0 ] && [ "$named" = "0" ] || exit 1
k=$(mkxy '.dm-mk--cluster' '')
echo "cluster at: $k"
[ -n "$k" ] && [ "$k" != "null" ] || exit 1
z0=$(ab eval 'window.__dmMap.getZoom()' | tr -d '"')
tap "$k"; sleep 1.5
z1=$(ab eval 'window.__dmMap.getZoom()' | tr -d '"')
echo "after cluster tap: zoom $z0 → $z1"
awk "BEGIN{exit !($z1 > $z0)}" || exit 1
echo PASS-CLUSTER
c=$(mkxy '.dm-mk:not(.dm-mk--district):not(.dm-mk--cluster)' '')
echo "community marker at: $c"
[ -n "$c" ] && [ "$c" != "null" ] || exit 1
tap "$c"; sleep 1
pop=$(ab eval '[...document.querySelectorAll(".dm-pop")].some(p=>p.offsetParent) ? 1 : 0')
echo "popover open: $pop"
[ "${pop//\"/}" = "1" ] || exit 1
echo PASS-BASIC

# 3) 进行中告警的小区：经告警列表飞到该小区 → 关闭弹窗 → 直接点红色标记 → 弹窗里应有告警行（时间/设备/内容）
ab eval '[...document.querySelectorAll(".alarms li.on:not(.off)")].find(l=>l.innerText.includes("金科蠡湖"))?.click() || document.querySelector(".alarms li.on:not(.off)")?.click(); 1' >/dev/null; sleep 2
# 关弹窗：在地图空白处真实点击一次（找一个不在标记/弹窗/面板上的点）
pt=$(ab eval 'JSON.stringify((()=>{for(let y=200;y<900;y+=37)for(let x=100;x<1300;x+=41){const el=document.elementFromPoint(x,y);if(el&&el.closest(".amap")&&!el.closest(".dm-mk")&&!el.closest(".dm-pop")&&!el.closest(".amap-marker"))return [x,y]}return null})())' | tr -d '"\\[]')
ab mouse move ${pt%,*} ${pt#*,} >/dev/null; ab mouse down >/dev/null; ab mouse up >/dev/null; sleep 1
closed=$(ab eval '[...document.querySelectorAll(".dm-pop")].some(p=>p.offsetParent) ? 0 : 1' | tr -d '"')
echo "popover closed: $closed"
[ "$closed" = "1" ] || exit 1
red=$(ab eval 'JSON.stringify((()=>{for(const m of document.querySelectorAll(".dm-mk--alarm:not(.dm-mk--district)")){const r=m.getBoundingClientRect();const x=r.x+r.width/2,y=r.y+r.height/2;if(m.contains(document.elementFromPoint(x,y)))return [Math.round(x),Math.round(y)]}return null})())' | tr -d '"\\[]')
echo "red marker at: $red"
[ -n "$red" ] && [ "$red" != "null" ] || exit 1
tap "$red"; sleep 1
rows=$(ab eval 'JSON.stringify([...document.querySelectorAll(".dm-pop li.al")].filter(l=>l.offsetParent).slice(0,3).map(l=>l.innerText.replace(/\s+/g," ")))')
echo "alarm rows: $rows"
case "$rows" in *级*) echo PASS-ALARM ;; *) exit 1;; esac

# 3b) 展开告警 → 真实鼠标点 × → 弹窗应关闭；再点红色标记重新打开（供第 4 步用）
xy() { ab eval "JSON.stringify((()=>{const a=[...document.querySelectorAll('$1')].find(x=>x.offsetParent);if(!a)return null;const r=a.getBoundingClientRect();return [Math.round(r.x+r.width/2),Math.round(r.y+r.height/2)]})())" | tr -d '"\\[]'; }
real() { ab mouse move ${1%,*} ${1#*,} >/dev/null; ab mouse down >/dev/null; ab mouse up >/dev/null; }
sum=$(xy '.dm-pop li.al--sum'); [ -n "$sum" ] && [ "$sum" != "null" ] && real "$sum"; sleep 0.6
x=$(xy '.dm-pop__x'); echo "close btn at: $x"; [ -n "$x" ] && [ "$x" != "null" ] || exit 1
real "$x"; sleep 0.8
gone=$(ab eval '[...document.querySelectorAll(".dm-pop")].some(p=>p.offsetParent) ? 0 : 1' | tr -d '"')
echo "closed by x: $gone"; [ "$gone" = "1" ] || exit 1
# 弹窗打开时可能平移过地图（避让界面）：重新取红色标记位置
red=$(ab eval 'JSON.stringify((()=>{for(const m of document.querySelectorAll(".dm-mk--alarm:not(.dm-mk--district)")){const r=m.getBoundingClientRect();const x=r.x+r.width/2,y=r.y+r.height/2;if(m.contains(document.elementFromPoint(x,y)))return [Math.round(x),Math.round(y)]}return null})())' | tr -d '"\\[]')
tap "$red"; sleep 1
echo PASS-CLOSE

# 4) 弹窗「详情 ›」→ 项目二级界面；返回地图后标记仍在（keep-alive 保留视图）
before=$(ab eval 'document.querySelectorAll(".dm-mk").length' | tr -d '"')
go=$(ab eval 'JSON.stringify((()=>{const a=[...document.querySelectorAll(".dm-pop .go")].find(x=>x.offsetParent);if(!a)return null;const r=a.getBoundingClientRect();return [Math.round(r.x+r.width/2),Math.round(r.y+r.height/2)]})())' | tr -d '"\\[]')
[ -n "$go" ] && [ "$go" != "null" ] || { echo "no 详情 link"; exit 1; }
ab mouse move ${go%,*} ${go#*,} >/dev/null; ab mouse down >/dev/null; ab mouse up >/dev/null; sleep 6
url=$(ab get url); echo "detail url: $url"
case "$url" in *"#/project/"*) ;; *) exit 1;; esac
name=$(ab eval 'document.querySelector(".sum__name")?.innerText || ""'); echo "detail name: ${name:0:30}"
[ -n "${name//\"/}" ] || exit 1
ab eval '[...document.querySelectorAll(".hbtn")].find(b=>b.innerText.includes("返回")).click(); 1' >/dev/null; sleep 2
after=$(ab eval 'document.querySelectorAll(".dm-mk").length' | tr -d '"')
echo "markers before/after detail: $before/$after"
[ "$after" -gt 0 ] && [ "$after" = "$before" ] || exit 1
echo PASS-DETAIL

# 5) 实时透传：打开在线项目详情（默认 生普账号的一个通用版项目，可用 LIVE_PID 覆盖），等查询结束，应有房间实时数据 + 设备在线点
LIVE_PID=${LIVE_PID:-6ad591da1e18559ea86299c1}
ab eval "location.hash='#/project/$LIVE_PID'; 1" >/dev/null; sleep 4
for i in $(seq 1 15); do b=$(ab eval 'document.querySelector(".live")?.innerText.includes("查询中") ? 1 : 0' | tr -d '"'); [ "$b" = "0" ] && break; sleep 2; done
live=$(ab eval 'JSON.stringify({rooms: document.querySelectorAll(".rr__card").length, online: document.querySelectorAll(".eq .dot.on").length, bar: document.querySelector(".live")?.innerText})')
echo "live: $live"
# 现场回执偶有超时：房间卡片或在线设备点至少其一有数据即通过
case "$live" in *'rooms\":0,\"online\":0'*) exit 1;; esac
echo PASS-LIVE
