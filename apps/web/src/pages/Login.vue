<template>
  <div class="login-page">
    <div class="login-card">
      <div class="login-brand">
        <div class="brand-mark" aria-hidden="true">Q</div>
        <h1 class="brand-title">Aether Quill</h1>
        <p class="brand-subtitle">面向中文小说创作者的 AI 写作助手</p>
      </div>

      <form class="login-form" @submit.prevent="handleLogin">
        <p v-if="errorMessage" class="aq-message aq-message--error" role="alert">
          {{ errorMessage }}
        </p>

        <div class="aq-field-group">
          <label class="aq-field-label" for="email">邮箱</label>
          <input
            id="email"
            v-model="email"
            class="aq-field-input"
            type="email"
            placeholder="admin@example.com"
            autocomplete="email"
            required
          />
        </div>

        <div class="aq-field-group">
          <label class="aq-field-label" for="password">密码</label>
          <input
            id="password"
            v-model="password"
            class="aq-field-input"
            type="password"
            placeholder="请输入密码"
            autocomplete="current-password"
            required
          />
        </div>

        <button class="aq-btn aq-btn-primary login-submit" type="submit" :disabled="loading">
          {{ loading ? '登录中...' : '登录' }}
        </button>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { presentError, presentSuccess } from '../utils/pageFeedback';

/** 路由实例 */
const router = useRouter();
/** 认证状态管理 */
const authStore = useAuthStore();

/** 邮箱 */
const email = ref('');
/** 密码 */
const password = ref('');
/** 是否正在登录 */
const loading = ref(false);
/** 错误消息 */
const errorMessage = ref('');

/**
 * 处理登录表单提交
 */
async function handleLogin() {
  if (!email.value.trim() || !password.value.trim()) {
    errorMessage.value = presentError('请填写邮箱和密码');
    return;
  }

  loading.value = true;
  errorMessage.value = '';

  try {
    await authStore.login(email.value.trim(), password.value);
    presentSuccess('登录成功');
    await router.push('/projects');
  } catch (error: any) {
    const message =
      error?.response?.data?.message || error?.message || '登录失败，请检查邮箱和密码';
    errorMessage.value = presentError(message);
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.login-page {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding: 1.5rem;
  background:
    radial-gradient(ellipse 80% 60% at 50% -10%, rgb(79 70 229 / 14%), transparent),
    radial-gradient(ellipse 60% 50% at 100% 100%, rgb(217 119 6 / 8%), transparent),
    var(--aq-bg);
}

.login-card {
  width: min(420px, 100%);
  padding: 2.5rem 2rem;
  background: var(--aq-surface);
  border: 1px solid var(--aq-border);
  border-radius: var(--aq-radius);
  box-shadow: var(--aq-shadow-lg);
}

.login-brand {
  text-align: center;
  margin-bottom: 2rem;
}

.brand-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 3rem;
  height: 3rem;
  margin-bottom: 1rem;
  border-radius: var(--aq-radius-sm);
  background: linear-gradient(135deg, var(--aq-primary) 0%, #6366f1 100%);
  color: var(--aq-text-inverse);
  font-family: var(--aq-font-display);
  font-size: 1.35rem;
  font-weight: 700;
}

.brand-title {
  font-family: var(--aq-font-display);
  font-size: 1.75rem;
  font-weight: 700;
  color: var(--aq-text);
  margin-bottom: 0.35rem;
  letter-spacing: -0.02em;
}

.brand-subtitle {
  color: var(--aq-text-secondary);
  font-size: 0.9rem;
  line-height: 1.5;
}

.login-form {
  display: flex;
  flex-direction: column;
}

.login-form .aq-field-group:last-of-type {
  margin-bottom: 1.25rem;
}

.login-submit {
  width: 100%;
  padding: 0.7rem;
  font-size: 1rem;
  font-weight: 600;
}
</style>
