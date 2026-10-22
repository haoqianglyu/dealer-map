<template>
  <div class="login">
    <div class="canvas" :style="screenStyle">
      <!-- 左：品牌舞台（预烘焙的粗粒度灯光点，仅 0.01° 网格计数，无小区名；登录前不请求任何项目数据） -->
      <div class="stage">
        <LightsCanvas class="stage__lights" :class="{ on: lightsOn }" />
        <div class="stage__vignette" />
        <BrandLogo v-if="brand" :name="brand.name" :height="44" class="stage__logo" />
        <div class="stage__copy">
          <h1>项目分布与运行告警</h1>
          <p>实时项目分布 · 一级告警 · 设备运行</p>
        </div>
        <div class="stage__foot">© {{ year }} {{ brand ? brand.name : '项目分布大屏' }}</div>
      </div>

      <!-- 右：登录表单 -->
      <div class="side">
        <form class="card" :class="{ shake }" novalidate @submit.prevent="submit" @animationend="shake = false">
          <h2>登录</h2>
          <p class="card__sub">使用平台账号登录，可见项目由账号权限决定</p>
          <p v-if="notice" class="card__notice" :class="{ 'card__notice--info': noticeTone === 'info' }" role="status">{{ notice }}</p>

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
import { ref, reactive, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { login } from '@/api'
import { errorText } from '@/api/http'
import { session } from '@/api/session'
import { prefetchAfterLogin, warmAmap } from '@/api/prefetch'
import { useScreenScale } from '@/composables/useScreenScale'
import { defaultBrand } from '@/config/brand'
import BrandLogo from '@/components/BrandLogo.vue'
import LightsCanvas from '@/components/LightsCanvas.vue'

const { style: screenStyle } = useScreenScale()
const router = useRouter()
const route = useRoute()
const brand = defaultBrand()
const year = new Date().getFullYear()
const ACCOUNT_KEY = 'dm_last_account' // 只记账号，不存密码

const mobile = ref(localStorage.getItem(ACCOUNT_KEY) || '')
const remember = ref(localStorage.getItem('dm_remember') !== '0') // 首次默认勾选
const password = ref('')
const showPwd = ref(false)
const caps = ref(false)
const busy = ref(false)
const done = ref(false)
const shake = ref(false)
const errs = reactive({ mobile: '', password: '' })
// 回登录页的原因：{ text, tone }（旧版本存的是纯文本 = 警示）
const readReason = () => {
  const raw = sessionStorage.getItem('dm_login_reason') || ''
  try {
    const o = JSON.parse(raw)
    if (o && typeof o.text === 'string') return o
  } catch {
    /* 纯文本 */
  }
  return { text: raw, tone: 'warn' }
}
const reason = readReason()
const notice = ref(reason.text)
const noticeTone = reason.tone
sessionStorage.removeItem('dm_login_reason')
const mobileEl = ref(null)
const pwdEl = ref(null)

document.title = `登录 · ${brand ? brand.name : '项目分布大屏'}`

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
    session.save(data, { newLogin: true })
    prefetchAfterLogin() // 立刻预热 /me、项目、坐标缓存、高德、地图 chunk（不等成功勾）
    remember.value ? localStorage.setItem(ACCOUNT_KEY, mobile.value) : localStorage.removeItem(ACCOUNT_KEY)
    localStorage.setItem('dm_remember', remember.value ? '1' : '0')
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

const lightsOn = ref(false)
onMounted(() => {
  ;(mobile.value ? pwdEl : mobileEl).value?.focus()
  setTimeout(() => (lightsOn.value = true), 200)
  // 高德 JS 不依赖登录：表单就绪后空闲时预载，登录后地图更快出现
  setTimeout(warmAmap, 1500)
})
</script>

<style scoped lang="scss">
/* ---------- 亮色主题（docs/fable-light-theme.md §6）：只加覆盖，深色规则不动 ---------- */
:root[data-theme='light'] {
  .login {
    background: #eef2f6;
  }
  .stage__vignette {
    background: radial-gradient(60% 80% at 38% 55%, rgba(14, 116, 144, 0.1), transparent 70%), linear-gradient(90deg, transparent 70%, #eef2f6);
  }
  .stage__copy {
    h1 {
      color: #10213a;
    }
    p {
      color: #3b4f6b;
    }
  }
  .stage__foot {
    color: #5b6b80;
  }
  .card {
    background: rgba(255, 255, 255, 0.88);
    border-color: rgba(16, 33, 58, 0.1);
    box-shadow: 0 24px 64px rgba(16, 33, 58, 0.14);
    color: #10213a;
    h2 {
      color: #10213a;
    }
  }
  .card__sub {
    color: #5b6b80;
  }
  .card__notice {
    color: #8a5200;
    background: rgba(161, 98, 7, 0.08);
    border-color: rgba(161, 98, 7, 0.35);
    &--info {
      color: var(--dm-text-3);
      background: rgba(16, 33, 58, 0.04);
      border-color: rgba(16, 33, 58, 0.12);
    }
  }
  .field {
    label {
      color: #3b4f6b;
    }
    input {
      color: #10213a;
      background: #ffffff;
      border-color: rgba(16, 33, 58, 0.16);
      &::placeholder {
        color: #7b8899;
      }
      &:hover {
        border-color: rgba(16, 33, 58, 0.28);
      }
      &:focus {
        border-color: #0e7490;
        box-shadow: 0 0 0 3px rgba(14, 116, 144, 0.18);
      }
      &:-webkit-autofill {
        -webkit-text-fill-color: #10213a;
        -webkit-box-shadow: 0 0 0 100px #ffffff inset;
        caret-color: #10213a;
      }
    }
    &.err input {
      border-color: rgba(215, 38, 61, 0.7);
      &:focus {
        box-shadow: 0 0 0 3px rgba(215, 38, 61, 0.18);
      }
    }
    .msg {
      color: #b42318;
      i {
        color: #fff;
        background: #d7263d;
      }
      &--warn {
        color: #8a5200;
        i {
          background: #a16207;
        }
      }
    }
  }
  .eye {
    color: #5b6b80;
    &:hover {
      color: #10213a;
      background: rgba(16, 33, 58, 0.06);
    }
    &:focus-visible {
      color: #10213a;
      box-shadow: 0 0 0 2px #0e7490 inset;
    }
  }
  .remember {
    color: #3b4f6b;
    input {
      accent-color: #0e7490;
      &:focus-visible {
        outline-color: #0e7490;
      }
    }
  }
  .submit {
    color: #fff;
    background: #0e7490;
    &:hover:not(:disabled) {
      background: #0b5f77;
    }
    &:focus-visible {
      outline: none;
      box-shadow: 0 0 0 2px #fff, 0 0 0 4px #0e7490;
    }
    &__spin {
      border-color: rgba(255, 255, 255, 0.35);
      border-top-color: #fff;
    }
    &.done {
      background: #0f8a5f;
    }
  }
}
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
    /* 主动退出：中性灰（不是警示） */
    &--info {
      color: var(--dm-text-3);
      background: rgba(120, 170, 255, 0.06);
      border-color: rgba(120, 170, 255, 0.16);
    }
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
    padding-right: 52px;
  }
}
/* 点按目标 ≥ 40px（电视遥控 / 触屏） */
.eye {
  position: absolute;
  top: 50%;
  right: 4px;
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  color: #6f8fb8;
  background: none;
  border: 0;
  border-radius: 6px;
  transform: translateY(-50%);
  cursor: pointer;
  &:hover {
    color: #e8f4ff;
    background: rgba(255, 255, 255, 0.06);
  }
  &:focus-visible {
    color: #e8f4ff;
    outline: none;
    box-shadow: 0 0 0 2px #35d4ff inset;
  }
}
.remember {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-height: 40px;
  margin-top: 6px;
  padding-right: 12px;
  font-size: 13px;
  color: #8fb0d0;
  cursor: pointer;
  user-select: none;
  input {
    width: 16px;
    height: 16px;
    accent-color: #35d4ff;
    cursor: pointer;
    &:focus-visible {
      outline: 2px solid #35d4ff;
      outline-offset: 2px;
    }
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
