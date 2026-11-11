#!/usr/bin/env bash
# deploy.sh 的小工具，单独放出来方便测试（tests/deploy-lib.test.mjs）。

# fc_check <aliyun fc GET 的路径>：资源存在返回 0，明确 404 返回 1，其它失败（权限、网络）返回 2 并打印错误
fc_check() {
  local out rc
  out=$(aliyun fc GET "$1" --profile chitu --region cn-hangzhou 2>&1) && return 0
  rc=$?
  if printf '%s' "$out" | grep -qE 'NotFound|HTTP Status: 404|"statusCode": ?404'; then
    return 1
  fi
  printf 'fc query failed (exit %s) for %s:\n%s\n' "$rc" "$1" "$out" >&2
  return 2
}

# smoke_check <base_url>：/ 返回 200 且含 id="app"；/api/me 未登录 401/403；高德代理可用（status=1）。不打印 key。
smoke_check() {
  local base="${1%/}" code body amap
  body=$(curl -sS --max-time 20 -o /dev/stdout -w '\n%{http_code}' "$base/") || { echo "smoke: GET / 请求失败" >&2; return 1; }
  code=${body##*$'\n'}
  [ "$code" = 200 ] || { echo "smoke: GET / 状态 $code" >&2; return 1; }
  printf '%s' "$body" | grep -q 'id="app"' || { echo 'smoke: GET / 缺少 id="app"' >&2; return 1; }
  code=$(curl -sS --max-time 20 -o /dev/null -w '%{http_code}' "$base/api/me")
  case "$code" in 401|403) ;; *) echo "smoke: GET /api/me 未登录返回 $code（应为 401/403）" >&2; return 1 ;; esac
  amap=$(curl -sS --max-time 20 -H "Referer: https://dealermap.cosyhome.com.cn/" "$base/_AMapService/v3/ip?key=${SMOKE_AMAP_KEY:-}&s=rsv3&platform=JS" || true)
  printf '%s' "$amap" | grep -q '"status":"1"' || { echo "smoke: 高德代理未返回 status=1" >&2; return 1; }
  echo "smoke: ok"
}

FC_CLI=(--profile chitu --region cn-hangzhou)

fc_alias_version() { # <fn_path> <alias>：打印别名指向的 versionId
  aliyun fc GET "$1/aliases/$2" "${FC_CLI[@]}" | python3 -I -c 'import json,sys; print(json.load(sys.stdin)["versionId"])'
}
fc_publish() { # <fn_path> <description>：发布版本，打印 versionId
  aliyun fc POST "$1/versions" --body "{\"description\":\"$2\"}" "${FC_CLI[@]}" | python3 -I -c 'import json,sys; print(json.load(sys.stdin)["versionId"])'
}
fc_alias_set() { # <fn_path> <alias> <versionId>：更新别名（已存在）
  aliyun fc PUT "$1/aliases/$2" --body "{\"versionId\":\"$3\"}" "${FC_CLI[@]}" >/dev/null
}
fc_alias_create() { # <fn_path> <alias> <versionId>
  aliyun fc POST "$1/aliases" --body "{\"aliasName\":\"$2\",\"versionId\":\"$3\"}" "${FC_CLI[@]}" >/dev/null
}
smoke_retry() { # <url>：新版本可能冷启动，最多 5 次，间隔 SMOKE_INTERVAL 秒
  local i
  for i in 1 2 3 4 5; do
    smoke_check "$1" && return 0
    sleep "${SMOKE_INTERVAL:-5}"
  done
  return 1
}
# 候选验证通过后切线上：把别名指到新版本，再按线上地址复验；复验失败自动指回旧版本
# promote <fn_path> <alias> <new_version> <old_version（首次部署为空）> <prod_url>
promote() {
  fc_alias_set "$1" "$2" "$3" || { echo "promote: 切换别名失败，线上不变" >&2; return 1; }
  if smoke_retry "$5"; then return 0; fi
  if [ -n "$4" ]; then
    echo "promote: 切换后线上验证失败，自动恢复到版本 $4" >&2
    fc_alias_set "$1" "$2" "$4" || echo "promote: 恢复失败！需手动：aliyun fc PUT $1/aliases/$2 --body '{\"versionId\":\"$4\"}'" >&2
  fi
  return 1
}
