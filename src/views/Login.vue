<template>
  <div class="login">
    <div class="glow" />
    <form class="box" @submit.prevent="submit">
      <div class="title"><span class="dot" />项目分布大屏<span class="dot" /></div>
      <p class="sub">PROJECT DISTRIBUTION MAP</p>
      <label>
        <span>账号</span>
        <input v-model.trim="mobile" name="mobile" autocomplete="username" placeholder="手机号 / 账号" />
      </label>
      <label>
        <span>密码</span>
        <input v-model="password" name="password" type="password" autocomplete="current-password" placeholder="登录密码" />
      </label>
      <p v-if="error" class="error">{{ error }}</p>
      <button type="submit" :disabled="busy">{{ busy ? '登录中…' : '登 录' }}</button>
      <p class="hint">使用平台账号登录；可见项目范围由账号权限决定。</p>
    </form>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { login } from '@/api'
import { session } from '@/api/session'

const router = useRouter()
const route = useRoute()
const mobile = ref('')
const password = ref('')
const busy = ref(false)
const error = ref('')

session.clear()

async function submit() {
  if (!mobile.value || !password.value) {
    error.value = '请输入账号和密码'
    return
  }
  busy.value = true
  error.value = ''
  try {
    const data = await login(mobile.value, password.value)
    if (!data?.access_token) throw new Error('登录失败')
    session.save(data)
    password.value = ''
    router.replace(typeof route.query.redirect === 'string' ? route.query.redirect : '/dealer-map')
  } catch (e) {
    error.value = e?.response?.data?.message || e?.message || '登录失败，请检查账号密码'
  } finally {
    busy.value = false
  }
}
</script>

<style scoped lang="scss">
.login {
  position: relative;
  width: 100vw;
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: url('@/assets/images/bg1.jpg') center / cover, #04070f;
}
.glow {
  position: absolute;
  inset: 0;
  background: radial-gradient(ellipse at center, rgba(0, 120, 255, 0.18), transparent 60%);
}
.box {
  position: relative;
  width: 400px;
  padding: 36px 36px 28px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  background: rgba(4, 14, 34, 0.78);
  border: 1px solid rgba(0, 212, 255, 0.35);
  border-radius: 10px;
  box-shadow: 0 0 40px rgba(0, 150, 255, 0.18), inset 0 0 24px rgba(0, 212, 255, 0.06);
  backdrop-filter: blur(6px);
  color: #d8ecff;
}
.title {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  font-size: 24px;
  font-weight: 600;
  letter-spacing: 4px;
  background: linear-gradient(180deg, #fff, #7ec7ff);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #00d4ff;
    box-shadow: 0 0 8px #00d4ff;
  }
}
.sub {
  margin-top: -10px;
  text-align: center;
  font-size: 11px;
  letter-spacing: 3px;
  color: #4f7fae;
}
label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  color: #7ec7ff;
}
input {
  height: 40px;
  padding: 0 12px;
  color: #e8f4ff;
  font-size: 14px;
  background: rgba(10, 30, 64, 0.7);
  border: 1px solid rgba(88, 158, 248, 0.35);
  border-radius: 6px;
  outline: none;
  &:focus {
    border-color: #00d4ff;
    box-shadow: 0 0 8px rgba(0, 212, 255, 0.35);
  }
}
button {
  height: 42px;
  margin-top: 4px;
  font-size: 15px;
  letter-spacing: 4px;
  color: #fff;
  background: linear-gradient(90deg, #1b62d8, #00a8e8);
  border: 0;
  border-radius: 6px;
  cursor: pointer;
  &:disabled {
    opacity: 0.6;
    cursor: default;
  }
}
.error {
  font-size: 13px;
  color: #ff8a7a;
}
.hint {
  font-size: 12px;
  color: #4f7fae;
  text-align: center;
}
</style>
