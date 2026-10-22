'use strict';
// 经销商项目地图：共享小区坐标缓存（Aliyun FC 3.0, Node.js 20, HTTP 触发器匿名 + 应用层鉴权）。
// 只经 Cloudflare Worker 的 /geo-shared 访问（浏览器不直连 FC）。
//   GET  /geo  -> { v, rev, updated_at, points: { "区县adcode|归一化查询串": { lng, lat, source, confirmed_at, matched_name, matched_address } } }
//   POST /geo  <- { key, adcode, lng, lat, matched_name, matched_address, source }
// 鉴权：把调用方的 Authorization（平台 token）转发到 control.cosyhome.com.cn/v1/me，必须 200。
// 只存「已确认」的坐标与高德返回的名称/地址；不存户号、客户姓名、电话等任何个人信息。
// OSS 不支持 PUT If-Match，用「create-only 版本锁」做乐观并发：rev/N 以 x-oss-forbid-overwrite 抢占，抢到才写 shared.json。
// 环境变量：OSS_AK_ID, OSS_AK_SECRET（可选，否则用函数角色 STS）, OSS_BUCKET, OSS_ENDPOINT, PLATFORM_BASE
const crypto = require('crypto');
const CENTERS = require('./centers.json'); // adcode -> [lng, lat]（区县/城市中心，粗校验用）

const PLATFORM = (process.env.PLATFORM_BASE || 'https://control.cosyhome.com.cn/v1').replace(/\/$/, '');
const OSS = {
  bucket: process.env.OSS_BUCKET || 'cosyhome-dealermap-wx',
  endpoint: process.env.OSS_ENDPOINT || 'oss-cn-hangzhou.aliyuncs.com',
  key: 'geo/shared.json',
};
const AUTH_TTL = 10 * 60 * 1000;
const READ_TTL = 30 * 1000;
const POST_PER_MIN = 60;
const POST_PER_DAY = 3000;

// ---------------------------------------------------------------- OSS（签名 v1，无依赖）
function ossReq(method, key, body, extra = {}, ctx) {
  const ak = process.env.OSS_AK_ID || (ctx && ctx.credentials && ctx.credentials.accessKeyId);
  const sk = process.env.OSS_AK_SECRET || (ctx && ctx.credentials && ctx.credentials.accessKeySecret);
  const sts = process.env.OSS_AK_ID ? null : (ctx && ctx.credentials && ctx.credentials.securityToken);
  if (!ak || !sk) throw new Error('no OSS credentials');
  const headers = { ...extra };
  if (sts) headers['x-oss-security-token'] = sts;
  const date = new Date().toUTCString(), type = body !== undefined ? 'application/json' : '';
  const oh = Object.keys(headers).filter((k) => k.startsWith('x-oss-')).sort().map((k) => `${k}:${headers[k]}\n`).join('');
  const sig = crypto.createHmac('sha1', sk).update(`${method}\n\n${type}\n${date}\n${oh}/${OSS.bucket}/${key}`).digest('base64');
  headers.date = date;
  headers.authorization = `OSS ${ak}:${sig}`;
  if (type) headers['content-type'] = type;
  return fetch(`https://${OSS.bucket}.${OSS.endpoint}/${key}`, { method, headers, body, signal: AbortSignal.timeout(8000) });
}
const empty = () => ({ v: 1, rev: 0, updated_at: null, points: {} });
async function readShared(ctx) {
  const r = await ossReq('GET', OSS.key, undefined, {}, ctx);
  if (r.status === 404) return empty();
  if (!r.ok) throw new Error(`oss get ${r.status}`);
  const d = await r.json();
  return d && d.points ? d : empty();
}

// 读缓存（实例内 30 秒）
let snap = null, snapAt = 0;
async function getShared(ctx, fresh = false) {
  if (!fresh && snap && Date.now() - snapAt < READ_TTL) return snap;
  snap = await readShared(ctx); snapAt = Date.now();
  return snap;
}

// 写：串行化（实例内）+ 版本锁（跨实例）
let chain = Promise.resolve();
function mergePoint(entry, ctx) {
  const run = chain.then(() => mergeOnce(entry, ctx));
  chain = run.catch(() => {});
  return run;
}
async function mergeOnce(entry, ctx) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const cur = await readShared(ctx);
    const prev = cur.points[entry.id];
    if (prev && prev.lng === entry.p.lng && prev.lat === entry.p.lat && prev.matched_name === entry.p.matched_name) return { changed: false, rev: cur.rev };
    const next = { ...cur, rev: (cur.rev || 0) + 1, updated_at: new Date().toISOString(), points: { ...cur.points, [entry.id]: entry.p } };
    const body = JSON.stringify(next);
    const lock = await ossReq('PUT', `geo/rev/${String(next.rev).padStart(8, '0')}.json`, body, { 'x-oss-forbid-overwrite': 'true' }, ctx);
    if (lock.status === 409) { await new Promise((r) => setTimeout(r, 150 + Math.random() * 350)); continue; } // 别人先写了：重读重试
    if (!lock.ok) throw new Error(`oss lock ${lock.status}`);
    const put = await ossReq('PUT', OSS.key, body, {}, ctx);
    if (!put.ok) throw new Error(`oss put ${put.status}`);
    snap = next; snapAt = Date.now();
    return { changed: true, rev: next.rev };
  }
  throw new Error('conflict');
}

// ---------------------------------------------------------------- 鉴权 / 限流
const authOk = new Map(); // sha256(token) -> 有效期
async function checkAuth(authz) {
  if (!/^Bearer\s+\S{10,}$/i.test(authz || '')) return null;
  const id = crypto.createHash('sha256').update(authz).digest('hex').slice(0, 32);
  const exp = authOk.get(id);
  if (exp && exp > Date.now()) return id;
  const r = await fetch(`${PLATFORM}/me`, { headers: { authorization: authz }, signal: AbortSignal.timeout(8000) });
  if (r.status !== 200) return null;
  if (authOk.size > 5000) authOk.clear();
  authOk.set(id, Date.now() + AUTH_TTL);
  return id;
}
const rate = new Map(); // tokenId -> { m, mT, d, dT }
function limited(id) {
  const now = Date.now();
  const h = rate.get(id) || { m: 0, mT: now, d: 0, dT: now };
  if (now - h.mT > 60000) { h.m = 0; h.mT = now; }
  if (now - h.dT > 86400000) { h.d = 0; h.dT = now; }
  h.m++; h.d++;
  rate.set(id, h);
  if (rate.size > 5000) rate.clear();
  return h.m > POST_PER_MIN || h.d > POST_PER_DAY;
}

// ---------------------------------------------------------------- 校验
// 户号：# 号，或「数字（阿拉伯 / 中文 / 字母楼号）+ 栋/幢/座/号楼/单元/室/层」；单个「元」「室」等字不算（「天元世家」「兰室」是小区名）
const UNIT_RE = /[#＃]|[0-9０-９A-Za-z一二三四五六七八九十百零〇两壹贰叁肆伍陆柒捌玖拾]+\s*(?:栋|幢|座|号楼|单元|室|层)/;
const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f]/g, '').trim().slice(0, n);
function validate(b) {
  if (!b || typeof b !== 'object') return 'bad body';
  const key = clean(b.key, 200);
  const adcode = String(b.adcode || '');
  const lng = Number(b.lng), lat = Number(b.lat);
  if (!key || key.length > 64) return 'bad key';
  if (/\d/.test(key)) return 'key must not contain digits'; // 归一化小区名里不会有楼栋/户号数字
  if (UNIT_RE.test(key)) return 'key looks like a unit address';
  if (!/^\d{6}$/.test(adcode)) return 'bad adcode';
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || lng < 73.4 || lng > 135.2 || lat < 18 || lat > 53.7) return 'outside China';
  const c = CENTERS[adcode] || CENTERS[adcode.slice(0, 4) + '00'];
  if (!c) return 'unknown adcode';
  if (Math.abs(lng - c[0]) > 1.5 || Math.abs(lat - c[1]) > 1.2) return 'outside adcode area';
  return {
    id: `${adcode}|${key}`,
    p: {
      lng: Number(lng.toFixed(6)),
      lat: Number(lat.toFixed(6)),
      source: clean(b.source, 20) || 'amap',
      confirmed_at: new Date().toISOString(),
      matched_name: clean(b.matched_name, 80),
      matched_address: clean(b.matched_address, 120),
    },
  };
}

// ---------------------------------------------------------------- HTTP
async function handle({ method, path, headers, body }, ctx) {
  headers = headers || {};
  const hv = (k) => headers[k] || headers[k.toLowerCase()] || headers[k.replace(/(^|-)([a-z])/g, (m) => m.toUpperCase())] || '';
  const h = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
  const out = (statusCode, b, extra = {}) => ({ statusCode, headers: { ...h, ...extra }, body: b === undefined ? '' : JSON.stringify(b) });
  path = (path || '/').replace(/\/+$/, '') || '/';
  if (path !== '/geo') return out(404, { error: 'not found' });
  if (method !== 'GET' && method !== 'POST') return out(405, { error: 'method not allowed' });
  let who;
  try { who = await checkAuth(hv('authorization')); } catch (e) { return out(503, { error: 'auth upstream unavailable' }); }
  if (!who) return out(401, { error: 'unauthorized' });
  try {
    if (method === 'GET') {
      const d = await getShared(ctx);
      const etag = `"r${d.rev || 0}"`;
      const cc = { etag, 'cache-control': 'private, max-age=30' };
      if (hv('if-none-match') === etag) return out(304, undefined, cc);
      return out(200, d, cc);
    }
    if (limited(who)) return out(429, { error: 'rate limited' }, { 'retry-after': '60' });
    let b; try { b = JSON.parse(body || '{}'); } catch (e) { return out(400, { error: 'bad json' }); }
    const v = validate(b);
    if (typeof v === 'string') return out(400, { error: v });
    const r = await mergePoint(v, ctx);
    return out(200, { ok: true, ...r });
  } catch (e) {
    console.error('geo error', e.message);
    return out(e.message === 'conflict' ? 409 : 503, { error: e.message === 'conflict' ? 'conflict, retry' : 'storage unavailable' });
  }
}

// 入口：兼容 FC 的两种 HTTP 形态 —— (req, resp, context) 以及事件式 (event, context[, callback])
exports.handler = async (a, b, c) => {
  let ev = {};
  try { ev = JSON.parse(Buffer.isBuffer(a) ? a.toString() : (typeof a === 'string' ? a : JSON.stringify(a || {}))) || {}; } catch (e) { /* 非 JSON 事件 */ }
  const http = (ev.requestContext && ev.requestContext.http) || {};
  let body = ev.body || '';
  if (body && ev.isBase64Encoded) body = Buffer.from(body, 'base64').toString();
  const r = await handle({ method: http.method || ev.httpMethod || 'GET', path: ev.rawPath || ev.path || '/', headers: ev.headers, body }, b);
  const res = { statusCode: r.statusCode, headers: r.headers, body: r.body, isBase64Encoded: false };
  if (typeof c === 'function') { c(null, res); return; }
  return res;
};
exports._test = { validate, handle };
