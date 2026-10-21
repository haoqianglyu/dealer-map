#!/usr/bin/env bash
# 部署 cosyhome-dealermap-geo 到 Aliyun FC 3.0（cn-hangzhou, profile chitu）。凭据全部来自 macOS Keychain，不落盘、不打印。
# 用法：functions/geo/deploy.sh   首次创建或更新函数 + HTTP 触发器（匿名；应用层用平台 token 鉴权）
set -euo pipefail
cd "$(dirname "$0")"
FN=cosyhome-dealermap-geo
PROFILE=${ALIYUN_PROFILE:-chitu}
REGION=cn-hangzhou
kc() { security find-generic-password -s "$1" -w; }
ENV_JSON=$(python3 -I -c 'import json,sys; print(json.dumps({"OSS_AK_ID":sys.argv[1],"OSS_AK_SECRET":sys.argv[2],"OSS_BUCKET":"cosyhome-dealermap-wx","OSS_ENDPOINT":"oss-cn-hangzhou.aliyuncs.com"}))' \
  "$(kc chitu-aliyun-ak-id)" "$(kc chitu-aliyun-ak-secret)")
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
zip -q -j "$TMP/code.zip" index.js package.json centers.json
ZIP=$(base64 < "$TMP/code.zip" | tr -d '\n')
python3 -I - "$ENV_JSON" "$ZIP" > "$TMP/body.json" <<'PY'
import json,sys
env=json.loads(sys.argv[1])
print(json.dumps({"functionName":"cosyhome-dealermap-geo","runtime":"nodejs20","handler":"index.handler","description":"经销商项目地图共享小区坐标缓存",
  "memorySize":256,"cpu":0.25,"diskSize":512,"timeout":20,"instanceConcurrency":20,"environmentVariables":env,"code":{"zipFile":sys.argv[2]}}))
PY
ali() { local i; for i in 1 2 3; do aliyun fc "$@" --profile "$PROFILE" --region "$REGION" && return 0; sleep 2; done; return 1; }
if aliyun fc GET "/2023-03-30/functions/$FN" --profile "$PROFILE" --region "$REGION" >/dev/null 2>&1; then
  python3 -I -c 'import json,sys; d=json.load(open(sys.argv[1])); d.pop("functionName"); d.pop("runtime"); json.dump(d, open(sys.argv[1],"w"))' "$TMP/body.json"
  ali PUT "/2023-03-30/functions/$FN" --body "$(cat "$TMP/body.json")" >/dev/null && echo "function updated"
else
  ali POST /2023-03-30/functions --body "$(cat "$TMP/body.json")" >/dev/null && echo "function created"
fi
if ! aliyun fc GET "/2023-03-30/functions/$FN/triggers/http" --profile "$PROFILE" --region "$REGION" >/dev/null 2>&1; then
  ali POST "/2023-03-30/functions/$FN/triggers" --body '{"triggerName":"http","triggerType":"http","triggerConfig":"{\"authType\":\"anonymous\",\"methods\":[\"GET\",\"POST\"],\"disableURLInternet\":false}"}' >/dev/null && echo "trigger created"
fi
ali GET "/2023-03-30/functions/$FN/triggers/http" | python3 -I -c 'import json,sys; print("URL:", json.load(sys.stdin)["httpTrigger"]["urlInternet"])'
