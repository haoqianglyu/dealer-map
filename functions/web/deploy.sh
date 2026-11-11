#!/usr/bin/env bash
# 部署 cosyhome-dealermap-web 到 Aliyun FC 3.0（cn-hangzhou, profile chitu）：静态页面 + 接口转发，一个函数。
# 凭据只来自 macOS Keychain（AMAP_JSCODE），不落盘（临时目录 700、退出即删）、不打印。
# 用法：functions/web/deploy.sh   构建 dist（与 wrangler.toml [build] 相同的环境变量，输出到临时目录，不动 ./dist）→ esbuild 打包
#       worker/core.js + 适配层 → zip → 创建/更新函数 + 匿名 HTTP 触发器。不绑定自定义域名。
# 前置：worker/data/geo-seed.json、geo-overrides.json 存在（见 README）；函数 cosyhome-dealermap-geo 已部署（取其 URL 作 GEO_FC_URL）。
set -euo pipefail
cd "$(dirname "$0")"
ROOT=$(cd ../.. && pwd)
source ./lib.sh
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/pkg"

# 1) 前端构建（同 wrangler.toml [build]；VITE_AMAP_SECURITY 置空 → 高德走 /_AMapService 代理）
(cd "$ROOT" && VITE_AMAP_SECURITY= VITE_FETCH_ALL=true VITE_PAGE_SIZE=100 npx vite build --outDir "$TMP/pkg/public" --emptyOutDir >/dev/null)
# 1b) 地图轮廓（388 个城市，约 21 MiB）不进函数包：传到 OSS，函数同源转发（entry.js fetchMap）
mkdir -p "$TMP/map-out"
mv "$TMP/pkg/public/map" "$TMP/map-out/map"
# 1c) 静态资源构建期预压缩（.br/.gz，随函数包部署；请求时不再压缩）
node precompress.mjs "$TMP/pkg/public"
mv "$TMP/map-out/map" "$TMP/pkg/public/map" # 轮廓不预压缩，构建完放回包里
# 2) 打包函数代码
"$ROOT/node_modules/.bin/esbuild" entry.js --bundle --platform=node --target=node20 --format=cjs --minify --outfile="$TMP/pkg/index.js" --log-level=warning
(cd "$TMP/pkg" && zip -qr ../code.zip index.js public)
echo "package: $(du -h "$TMP/code.zip" | cut -f1)"

# 地图轮廓随代码包发布：OSS 账号禁止公开读 ACL，不能走匿名回源

# 2b) 代码包先传同地域 OSS（分片 + 断点续传，慢链路也不会整包重来），FC 再从 OSS 取；部署结束即删
OSS_BUCKET=cosyhome-dealermap-wx
OSS_KEY="tmp/deploy/web-$(date +%s).zip"
OSS_EP=oss-cn-hangzhou.aliyuncs.com
for up in 1 2 3 4 5 6; do
  aliyun oss cp "$TMP/code.zip" "oss://$OSS_BUCKET/$OSS_KEY" --profile chitu -e "$OSS_EP" -f --acl private \
    --bigfile-threshold 1048576 --part-size 524288 -j 2 --checkpoint-dir "$TMP/oss-cp" --retry-times 10 && break
  [ "$up" = 6 ] && { echo "oss upload failed" >&2; exit 1; }
  sleep 5
done
trap 'aliyun oss rm "oss://$OSS_BUCKET/$OSS_KEY" --profile chitu -e "$OSS_EP" -f >/dev/null 2>&1 || true; rm -rf "$TMP"' EXIT
# 3) 环境变量（AMAP_JSCODE 来自 Keychain；GEO_FC_URL 取 geo 函数的触发器地址）
GEO_URL=$(aliyun fc GET /2023-03-30/functions/cosyhome-dealermap-geo/triggers/http --profile chitu --region cn-hangzhou | python3 -I -c 'import json,sys; print(json.load(sys.stdin)["httpTrigger"]["urlInternet"])')
AMAP_JSCODE=$(security find-generic-password -s chitu-amap-dealermap-security -w)
[ -n "$AMAP_JSCODE" ] && [ -n "$GEO_URL" ] || { echo "missing AMAP_JSCODE or GEO_URL" >&2; exit 1; }
python3 -I - "$AMAP_JSCODE" "$GEO_URL" "$OSS_BUCKET" "$OSS_KEY" > "$TMP/body.json" <<'PY'
import json,sys,base64
env={"AMAP_JSCODE":sys.argv[1],"GEO_FC_URL":sys.argv[2]}
print(json.dumps({"functionName":"cosyhome-dealermap-web","runtime":"nodejs20","handler":"index.handler","description":"经销商项目地图：静态页面 + 接口转发（复用 worker/core.js）",
  "memorySize":512,"cpu":0.5,"diskSize":512,"timeout":30,"instanceConcurrency":20,"environmentVariables":env,
  "code":{"ossBucketName":sys.argv[3],"ossObjectName":sys.argv[4]}}))
PY
# 线上流量走 http 触发器 → 别名 prod → 固定版本，LATEST 只是草稿。流程：
#   a) 切换前先把回滚点定好：prod 别名已有 → 记下当前版本；首次（线上触发器还指 LATEST）→ 把当前 LATEST 发布成版本、建 prod 别名、触发器改指 prod（代码不变，线上无感）
#   b) 更新 LATEST → 发布新版本 → 建临时 candidate 触发器指向新版本 → 在候选地址冒烟（此时线上还是旧版本）
#   c) 冒烟通过才把 prod 指到新版本；切完按线上地址复验，失败自动指回旧版本
# 用到的 FC 3.0 接口：PublishFunctionVersion、CreateAlias / UpdateAlias、CreateTrigger / UpdateTrigger（qualifier）。
# 待实测（账号上尚未跑过，失败时脚本在切线上之前退出）：① 同一函数能否同时有 http 和 candidate 两个 HTTP 触发器（qualifier 不同）；
#   ② UpdateTrigger 改 qualifier 后，原 urlInternet 是否不变；③ LATEST 无变化时 PublishFunctionVersion 的报错。
# 注意：自定义域名 dealermap.cosyhome.com.cn 的路由 qualifier 是 LATEST，更新 LATEST 后线上立即生效；
# prod 别名只控制 fcapp.run 触发器。域名路由切 prod 前，「冒烟失败不影响线上」只对触发器成立。
FN=/2023-03-30/functions/cosyhome-dealermap-web
CAND=candidate
OLD_VER=""
fc_check "$FN" && FN_EXISTS=1 || { rc=$?; [ "$rc" = 1 ] && FN_EXISTS=0 || { echo "abort: 查询函数失败（不是 404），不创建也不更新" >&2; exit 1; }; }
if [ "$FN_EXISTS" = 1 ]; then
  fc_check "$FN/aliases/prod" && HAS_ALIAS=1 || { rc=$?; [ "$rc" = 1 ] && HAS_ALIAS=0 || { echo "abort: 查询别名失败（不是 404）" >&2; exit 1; }; }
  if [ "$HAS_ALIAS" = 1 ]; then
    OLD_VER=$(fc_alias_version "$FN" prod)
  else
    OLD_VER=$(fc_publish "$FN" "pre-candidate snapshot $(date +%Y-%m-%dT%H:%M)")
    fc_alias_create "$FN" prod "$OLD_VER"
    fc_check "$FN/triggers/http" && HAS_TRIGGER=1 || { rc=$?; [ "$rc" = 1 ] && HAS_TRIGGER=0 || { echo "abort: 查询触发器失败（不是 404）" >&2; exit 1; }; }
    if [ "$HAS_TRIGGER" = 1 ]; then
      aliyun fc PUT "$FN/triggers/http" --body '{"qualifier":"prod"}' "${FC_CLI[@]}" >/dev/null
      echo "migrated: 线上触发器改指别名 prod（版本 $OLD_VER，代码不变）"
    fi
  fi
  [ -n "$OLD_VER" ] || { echo "abort: 拿不到旧版本号" >&2; exit 1; }
  echo "rollback point: version $OLD_VER"
fi

# 请求体只含 OSS 位置；偶发 500 时最多重试 3 次
for try in 1 2 3; do
  if [ "$FN_EXISTS" = 1 ]; then
    [ -f "$TMP/update.json" ] || python3 -I -c 'import json,sys; d=json.load(open(sys.argv[1])); d.pop("functionName"); d.pop("runtime"); json.dump(d, open(sys.argv[2],"w"))' "$TMP/body.json" "$TMP/update.json"
    aliyun fc PUT "$FN" --body-file "$TMP/update.json" --read-timeout 500 --connect-timeout 30 "${FC_CLI[@]}" >/dev/null && { echo "function updated (LATEST only, not live)"; break; }
  else
    aliyun fc POST /2023-03-30/functions --body-file "$TMP/body.json" --read-timeout 500 --connect-timeout 30 "${FC_CLI[@]}" >/dev/null && { echo "function created"; break; }
  fi
  [ "$try" = 3 ] && { echo "deploy failed" >&2; exit 1; }
  sleep 3
done

NEW_VER=$(fc_publish "$FN" "deploy $(date +%Y-%m-%dT%H:%M)")
[ -n "$NEW_VER" ] || { echo "abort: 发布新版本失败，线上不变" >&2; exit 1; }
echo "published candidate version: $NEW_VER"

TRIGGER_CONFIG='"{\"authType\":\"anonymous\",\"methods\":[\"GET\",\"POST\",\"HEAD\"],\"disableURLInternet\":false}"'
if [ "$FN_EXISTS" = 0 ]; then
  # 新函数：没有旧版本要保护，直接建 prod 别名和线上触发器
  fc_alias_create "$FN" prod "$NEW_VER"
  aliyun fc POST "$FN/triggers" --body "{\"triggerName\":\"http\",\"triggerType\":\"http\",\"qualifier\":\"prod\",\"triggerConfig\":$TRIGGER_CONFIG}" "${FC_CLI[@]}" >/dev/null && echo "trigger created"
else
  # 老函数但没有 http 触发器（只有手动删过才会）：补上并指 prod
  fc_check "$FN/triggers/http" && HAS_TRIGGER=1 || { rc=$?; [ "$rc" = 1 ] && HAS_TRIGGER=0 || { echo "abort: 查询触发器失败（不是 404）" >&2; exit 1; }; }
  if [ "$HAS_TRIGGER" = 0 ]; then
    aliyun fc POST "$FN/triggers" --body "{\"triggerName\":\"http\",\"triggerType\":\"http\",\"qualifier\":\"prod\",\"triggerConfig\":$TRIGGER_CONFIG}" "${FC_CLI[@]}" >/dev/null && echo "trigger created"
  fi
fi
URL=$(aliyun fc GET "$FN/triggers/http" "${FC_CLI[@]}" | python3 -I -c 'import json,sys; print(json.load(sys.stdin)["httpTrigger"]["urlInternet"])')
echo "URL: $URL"

# 候选冒烟：临时 HTTP 触发器 → 新版本，验证通过才动线上
SMOKE_AMAP_KEY=$(grep -E '^VITE_AMAP_KEY=' "$ROOT/.env.local" 2>/dev/null | head -1 | cut -d= -f2- || true)
export SMOKE_AMAP_KEY
del_cand() { aliyun fc DELETE "$FN/triggers/$CAND" "${FC_CLI[@]}" >/dev/null 2>&1 || true; }
trap 'del_cand; aliyun oss rm "oss://$OSS_BUCKET/$OSS_KEY" --profile chitu -e "$OSS_EP" -f >/dev/null 2>&1 || true; rm -rf "$TMP"' EXIT
if [ "$FN_EXISTS" = 1 ]; then
  del_cand
  aliyun fc POST "$FN/triggers" --body "{\"triggerName\":\"$CAND\",\"triggerType\":\"http\",\"qualifier\":\"$NEW_VER\",\"triggerConfig\":$TRIGGER_CONFIG}" "${FC_CLI[@]}" >/dev/null \
    || { echo "abort: 建候选触发器失败，线上仍是版本 $OLD_VER（待实测项 ①）" >&2; exit 1; }
  CAND_URL=$(aliyun fc GET "$FN/triggers/$CAND" "${FC_CLI[@]}" | python3 -I -c 'import json,sys; print(json.load(sys.stdin)["httpTrigger"]["urlInternet"])')
  smoke_retry "$CAND_URL" || { echo "abort: 候选版本 $NEW_VER 冒烟失败，线上仍是版本 $OLD_VER" >&2; exit 1; }
  promote "$FN" prod "$NEW_VER" "$OLD_VER" "$URL" || exit 1
else
  smoke_retry "$URL" || { echo "smoke failed: 新函数未通过验证" >&2; exit 1; }
fi
echo "live version: $NEW_VER  (rollback: aliyun fc PUT $FN/aliases/prod --body '{\"versionId\":\"${OLD_VER:-<旧版本号>}\"}' --profile chitu --region cn-hangzhou)"
