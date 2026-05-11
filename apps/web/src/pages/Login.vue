<template>
  <div class="login-page">
    <div class="login-card">
      <!-- 品牌标识 -->
      <div class="login-brand">
        <h1 class="brand-title">Aether Quill</h1>
        <p class="brand-subtitle">小说写作助手</p>
      </div>

      <!-- 登录表单 -->
      <form class="login-form" @submit.prevent="handleLogin">
        <!-- 错误提示 -->
        <p v-if="errorMessage" class="message message-error">{{ errorMessage }}</p>

        <!-- 邮箱输入 -->
        <div class="field-group">
          <label class="field-label" for="email">邮箱</label>
          <input
            id="email"
            v-model="email"
            class="field-input"
            type="email"
            placeholder="admin@example.com"
            autocomplete="email"
            required
          />
        </div>

        <!-- 密码输入 -->
        <div class="field-group">
          <label class="field-label" for="password">密码</label>
          <input
            id="password"
            v-model="password"
            class="field-input"
            type="password"
            placeholder="password123"
            autocomplete="current-password"
            required
          />
        </div>

        <!-- 登录按钮 -->
        <button class="primary-button" type="submit" :disabled="loading">
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
  // 验证输入
  if (!email.value.trim() || !password.value.trim()) {
    errorMessage.value = '请填写邮箱和密码';
    return;
  }

  loading.value = true;
  errorMessage.value = '';

  try {
    // 调用登录接口
    await authStore.login(email.value.trim(), password.value);
    // 登录成功后跳转至项目列表
    await router.push('/projects');
  } catch (error: any) {
    // 处理登录失败
    const message =
      error?.response?.data?.message || error?.message || '登录失败，请检查邮箱和密码';
    errorMessage.value = message;
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
  background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
}

.login-card {
  width: 400px;
  padding: 2.5rem;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.1);
}

.login-brand {
  text-align: center;
  margin-bottom: 2rem;
}

.brand-title {
  font-size: 1.75rem;
  font-weight: 700;
  color: #1a1a2e;
  margin-bottom: 0.25rem;
}

.brand-subtitle {
  color: #666;
  font-size: 0.95rem;
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.field-group {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.field-label {
  font-weight: 600;
  font-size: 0.9rem;
  color: #333;
}

.field-input {
  width: 100%;
  border: 1px solid #d9d9d9;
  border-radius: 8px;
  padding: 0.65rem 0.75rem;
  font-size: 0.95rem;
  transition: border-color 0.2s;
}

.field-input:focus {
  outline: none;
  border-color: #1d4ed8;
  box-shadow: 0 0 0 3px rgba(29, 78, 216, 0.1);
}

.primary-button {
  width: 100%;
  border: none;
  background: #1d4ed8;
  color: #fff;
  border-radius: 8px;
  padding: 0.7rem;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s;
  margin-top: 0.5rem;
}

.primary-button:hover {
  background: #1e40af;
}

.primary-button:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

.message {
  font-size: 0.9rem;
  text-align: center;
}

.message-error {
  color: #b42318;
  background: #fef2f2;
  padding: 0.5rem;
  border-radius: 6px;
}
</style>
