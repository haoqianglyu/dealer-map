<template>
  <div class="login">
    <div class="canvas" :style="screenStyle">
      <!-- 左：品牌舞台（预烘焙的粗粒度灯光点，仅 0.01° 网格计数，无小区名；登录前不请求任何项目数据） -->
      <div class="stage">
        <canvas ref="cv" class="stage__lights" :class="{ on: lightsOn }" />
        <div class="stage__vignette" />
        <BrandLogo v-if="brand" :name="brand.name" :height="44" class="stage__logo" />
        <div class="stage__copy">
          <h1>项目分布与运行告警</h1>
          <p>{{ brand ? `${brand.name} · ` : '' }}实时项目分布 · 一级告警 · 设备运行</p>
        </div>
        <div class="stage__foot">© {{ year }} {{ brand ? brand.name : '项目分布大屏' }}</div>
      </div>

      <!-- 右：登录表单 -->
      <div class="side">
        <form class="card" :class="{ shake }" novalidate @submit.prevent="submit" @animationend="shake = false">
          <h2>登录</h2>
          <p class="card__sub">使用平台账号登录，可见项目由账号权限决定</p>
          <p v-if="notice" class="card__notice" role="status">{{ notice }}</p>

          <div class="field" :class="{ err: errs.mobile }">
            <label for="lg-mobile">账号</label>
            <input id="lg-mobile" ref="mobileEl" v-model.trim="mobile" name="mobile" autocomplete="username" placeholder="手机号 / 账号" :aria-invalid="!!errs.mobile" @input="errs.mobile = ''" />
            <p v-if="errs.mobile" class="msg" role="alert"><i>!</i>{{ errs.mobile }}</p>
          </div>

          <div class="field" :class="{ err: errs.password }">
            <label for="lg-pwd">密码</label>
            <div class="pwd">
              <input
                id="lg-pwd"
                ref="pwdEl"
                v-model="password"
                name="password"
                :type="showPwd ? 'text' : 'password'"
                autocomplete="current-password"
                placeholder="登录密码"
                :aria-invalid="!!errs.password"
                @input="errs.password = ''"
                @keyup="capsCheck"
                @keydown="capsCheck"
              />
              <button type="button" class="eye" :aria-label="showPwd ? '隐藏密码' : '显示密码'" :title="showPwd ? '隐藏密码' : '显示密码'" @click="showPwd = !showPwd">
                <svg v-if="!showPwd" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="1.6" /><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.6" /></svg>
                <svg v-else viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M3 3l18 18M10.6 5.1A10.8 10.8 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.9 8.3 2 12 2 12s3.6 7 10 7c1.9 0 3.5-.6 4.9-1.4M9.9 9.9a3 3 0 0 0 4.2 4.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg>
              </button>
            </div>
            <p v-if="errs.password" class="msg" role="alert"><i>!</i>{{ errs.password }}</p>
            <p v-else-if="caps" class="msg msg--warn"><i>⇪</i>大写锁定已开启</p>
          </div>

          <label class="remember"><input v-model="remember" type="checkbox" /><span>记住账号</span></label>

          <button type="submit" class="submit" :class="{ busy, done }" :disabled="busy || done">
            <span class="submit__txt">登录</span>
            <span class="submit__spin" />
            <svg class="submit__ok" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" /></svg>
          </button>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, onBeforeUnmount } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { login } from '@/api'
import { errorText } from '@/api/http'
import { session } from '@/api/session'
import { useScreenScale } from '@/composables/useScreenScale'
import { defaultBrand } from '@/config/brand'
import BrandLogo from '@/components/BrandLogo.vue'
import LIGHTS from '@/assets/login-lights.json'

const { style: screenStyle } = useScreenScale()
const router = useRouter()
const route = useRoute()
const brand = defaultBrand()
const year = new Date().getFullYear()
const ACCOUNT_KEY = 'dm_last_account' // 只记账号，不存密码

const mobile = ref(localStorage.getItem(ACCOUNT_KEY) || '')
const remember = ref(Boolean(localStorage.getItem(ACCOUNT_KEY)))
const password = ref('')
const showPwd = ref(false)
const caps = ref(false)
const busy = ref(false)
const done = ref(false)
const shake = ref(false)
const errs = reactive({ mobile: '', password: '' })
const notice = ref(sessionStorage.getItem('dm_login_reason') || '')
sessionStorage.removeItem('dm_login_reason')
const mobileEl = ref(null)
const pwdEl = ref(null)

session.clear()
document.title = '登录 · 项目分布大屏'

const capsCheck = (e) => (caps.value = Boolean(e.getModifierState && e.getModifierState('CapsLock')))

function fail(field, msg) {
  errs[field] = msg
  shake.value = true
  ;(field === 'mobile' ? mobileEl : pwdEl).value?.focus()
}

async function submit() {
  errs.mobile = errs.password = ''
  if (!mobile.value) return fail('mobile', '请输入账号')
  if (!password.value) return fail('password', '请输入密码')
  busy.value = true
  notice.value = ''
  try {
    const data = await login(mobile.value, password.value)
    if (!data?.access_token) throw new Error('登录失败')
    session.save(data)
    remember.value ? localStorage.setItem(ACCOUNT_KEY, mobile.value) : localStorage.removeItem(ACCOUNT_KEY)
    password.value = ''
    busy.value = false
    done.value = true
    await new Promise((r) => setTimeout(r, 300))
    router.replace(typeof route.query.redirect === 'string' ? route.query.redirect : '/dealer-map')
  } catch (e) {
    busy.value = false
    const st = e?.response?.status
    fail('password', st && st < 500 ? errorText(e, '账号或密码错误，请重试') : errorText(e))
  }
}

// ---------- 舞台灯光（canvas，复用热力暖光的三层径向渐变 + lighter 叠加，4 s 缓慢呼吸） ----------
const cv = ref(null)
const lightsOn = ref(false)
let raf = 0
const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
const HALO = [255, 184, 87]
const CORE = [255, 222, 158]
const FIL = [255, 245, 219]
function glow(ctx, x, y, r, [R, G, B], a) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r)
  g.addColorStop(0, `rgba(${R},${G},${B},${a})`)
  g.addColorStop(0.5, `rgba(${R},${G},${B},${a / 2})`)
  g.addColorStop(1, `rgba(${R},${G},${B},0)`)
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
}
function draw(t = 0) {
  const c = cv.value
  if (!c) return
  const w = c.clientWidth
  const h = c.clientHeight
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  if (c.width !== Math.round(w * dpr)) {
    c.width = Math.round(w * dpr)
    c.height = Math.round(h * dpr)
  }
  const ctx = c.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)
  ctx.globalCompositeOperation = 'lighter'
  const k = (h * 0.95) / 1.6 // 像素 / 纬度
  const cx = w * 0.55
  const cy = h * 0.52
  const breath = reduced ? 1 : 0.92 + 0.08 * Math.sin((t / 4000) * Math.PI * 2)
  for (const [lng, lat, n] of LIGHTS) {
    const x = cx + (lng - 120.3) * k * 0.853
    const y = cy - (lat - 31.55) * k
    if (x < -40 || y < -40 || x > w + 40 || y > h + 40) continue
    const r = 10 + Math.sqrt(n) * 9
    glow(ctx, x, y, r, HALO, 0.42 * breath)
    glow(ctx, x, y, Math.min(r * 0.3, 7), CORE, 0.6)
    glow(ctx, x, y, 2.4, FIL, 0.9)
  }
  ctx.globalCompositeOperation = 'source-over'
  if (!reduced) raf = requestAnimationFrame(draw)
}
onMounted(() => {
  ;(mobile.value ? pwdEl : mobileEl).value?.focus()
  setTimeout(() => (lightsOn.value = true), 200)
  raf = requestAnimationFrame(draw)
})
onBeforeUnmount(() => cancelAnimationFrame(raf))
</script>

<style scoped lang="scss">
.login {
  position: relative;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background: #040b18;
}
.canvas {
  display: flex;
}
.stage {
  position: relative;
  flex: 0 0 62%;
  height: 100%;
  overflow: hidden;
  &__lights {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    transition: opacity 0.8s ease;
    &.on {
      opacity: 0.85;
    }
  }
  &__vignette {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background: radial-gradient(60% 80% at 38% 55%, rgba(27, 98, 216, 0.16), transparent 70%), linear-gradient(90deg, transparent 70%, #040b18);
  }
  &__logo {
    position: absolute;
    left: 96px;
    top: 72px;
  }
  &__copy {
    position: absolute;
    left: 96px;
    bottom: 160px;
    h1 {
      font-size: 40px;
      line-height: 1.2;
      font-weight: 600;
      color: #f2f7ff;
    }
    p {
      margin-top: 12px;
      font-size: 16px;
      color: #8fb0d0;
    }
  }
  &__foot {
    position: absolute;
    left: 96px;
    bottom: 48px;
    font-size: 12px;
    color: #6f8fb8;
  }
}
.side {
  flex: 1;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}
.card {
  width: 420px;
  padding: 40px;
  display: flex;
  flex-direction: column;
  background: rgba(8, 20, 44, 0.72);
  border: 1px solid rgba(120, 170, 255, 0.16);
  border-radius: 14px;
  backdrop-filter: blur(16px);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.45);
  color: #e8f4ff;
  animation: card-in 0.32s ease-out both;
  &.shake {
    animation: shake 0.24s ease-in-out;
  }
  h2 {
    font-size: 22px;
    font-weight: 600;
    color: #f2f7ff;
  }
  &__sub {
    margin-top: 6px;
    font-size: 13px;
    color: #8fb0d0;
  }
  &__notice {
    margin-top: 16px;
    padding: 8px 12px;
    font-size: 13px;
    color: #ffd76a;
    background: rgba(255, 199, 34, 0.08);
    border: 1px solid rgba(255, 199, 34, 0.3);
    border-radius: 8px;
  }
}
@keyframes card-in {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
}
@keyframes shake {
  25% {
    transform: translateX(-6px);
  }
  75% {
    transform: translateX(6px);
  }
}
.field {
  margin-top: 20px;
  &:first-of-type {
    margin-top: 28px;
  }
  label {
    display: block;
    margin-bottom: 8px;
    font-size: 13px;
    color: #8fb0d0;
  }
  input {
    width: 100%;
    height: 48px;
    padding: 0 14px;
    font: inherit;
    font-size: 15px;
    color: #e8f4ff;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    outline: none;
    transition: border-color 0.12s, box-shadow 0.12s;
    &::placeholder {
      color: #4f6e93;
    }
    &:hover {
      border-color: rgba(255, 255, 255, 0.18);
    }
    &:focus {
      border-color: #35d4ff;
      box-shadow: 0 0 0 3px rgba(53, 212, 255, 0.18);
    }
    &:-webkit-autofill {
      -webkit-text-fill-color: #e8f4ff;
      -webkit-box-shadow: 0 0 0 100px #0b1a33 inset;
      caret-color: #e8f4ff;
    }
  }
  &.err input {
    border-color: rgba(255, 138, 122, 0.7);
    &:focus {
      box-shadow: 0 0 0 3px rgba(255, 138, 122, 0.18);
    }
  }
  .msg {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 8px;
    font-size: 13px;
    color: #ff8a7a;
    i {
      flex: none;
      width: 14px;
      height: 14px;
      display: grid;
      place-items: center;
      font: 700 10px/1 sans-serif;
      font-style: normal;
      color: #04121f;
      background: #ff8a7a;
      border-radius: 50%;
    }
    &--warn {
      color: #ffc722;
      i {
        background: #ffc722;
      }
    }
  }
}
.pwd {
  position: relative;
  input {
    padding-right: 44px;
  }
}
.eye {
  position: absolute;
  top: 50%;
  right: 8px;
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  color: #6f8fb8;
  background: none;
  border: 0;
  border-radius: 6px;
  transform: translateY(-50%);
  cursor: pointer;
  &:hover,
  &:focus-visible {
    color: #e8f4ff;
    background: rgba(255, 255, 255, 0.06);
    outline: none;
  }
}
.remember {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
  font-size: 13px;
  color: #8fb0d0;
  cursor: pointer;
  user-select: none;
  input {
    width: 16px;
    height: 16px;
    accent-color: #35d4ff;
    cursor: pointer;
  }
}
.submit {
  position: relative;
  height: 48px;
  margin-top: 28px;
  font: inherit;
  font-size: 16px;
  font-weight: 600;
  letter-spacing: 2px;
  color: #04121f;
  background: #35d4ff;
  border: 0;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s, transform 0.1s;
  &:hover:not(:disabled) {
    background: #5fddff;
  }
  &:active:not(:disabled) {
    transform: scale(0.98);
  }
  &:focus-visible {
    outline: 2px solid #f2f7ff;
    outline-offset: 2px;
  }
  &:disabled {
    cursor: default;
  }
  &__txt {
    transition: opacity 0.15s;
  }
  &__spin,
  &__ok {
    position: absolute;
    left: 50%;
    top: 50%;
    opacity: 0;
    transform: translate(-50%, -50%);
    transition: opacity 0.15s;
  }
  &__spin {
    width: 18px;
    height: 18px;
    border: 2px solid rgba(4, 18, 31, 0.25);
    border-top-color: #04121f;
    border-radius: 50%;
  }
  &.busy {
    .submit__txt {
      opacity: 0;
    }
    .submit__spin {
      opacity: 1;
      animation: spin 0.8s linear infinite;
    }
  }
  &.done {
    background: #00e2a1;
    .submit__txt {
      opacity: 0;
    }
    .submit__ok {
      opacity: 1;
    }
  }
}
@keyframes spin {
  to {
    transform: translate(-50%, -50%) rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .card {
    animation: none;
  }
}
</style>
