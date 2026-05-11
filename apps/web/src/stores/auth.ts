import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { apiClient } from '../services/api';

/**
 * 认证状态管理 Store
 * 用于管理用户登录状态、token 和用户信息
 */
export const useAuthStore = defineStore('auth', () => {
  /** 用户访问令牌 */
  const token = ref(localStorage.getItem('token') || '');
  /** 刷新令牌 */
  const refreshTokenValue = ref(localStorage.getItem('refreshToken') || '');
  /** 用户信息 */
  const user = ref<{ userId: string; email: string; name: string } | null>(null);

  /** 是否已认证 */
  const isAuthenticated = computed(() => !!token.value);
  /** 用户名 */
  const userName = computed(() => user.value?.name || '');

  /**
   * 用户登录
   * @param {string} email - 邮箱
   * @param {string} password - 密码
   */
  async function login(email: string, password: string) {
    const response = (await apiClient.auth.login({ email, password })) as any;
    const data = response?.data ?? response;
    token.value = data.accessToken || data.token || '';
    refreshTokenValue.value = data.refreshToken || '';
    localStorage.setItem('token', token.value);
    localStorage.setItem('refreshToken', refreshTokenValue.value);
    user.value = data.user || null;
  }

  /**
   * 获取当前用户信息
   */
  async function fetchMe() {
    if (!token.value) return;
    try {
      const response = (await apiClient.auth.me()) as any;
      const data = response?.data ?? response;
      user.value = {
        userId: data.userId || data.id || '',
        email: data.email || '',
        name: data.name || '',
      };
    } catch {
      logout();
    }
  }

  /**
   * 用户登出
   */
  function logout() {
    token.value = '';
    refreshTokenValue.value = '';
    user.value = null;
    localStorage.removeItem('token');
    localStorage.removeItem('refreshToken');
  }

  /**
   * 初始化认证状态
   */
  function init() {
    if (token.value) {
      void fetchMe();
    }
  }

  return {
    token,
    refreshToken: refreshTokenValue,
    user,
    isAuthenticated,
    userName,
    login,
    fetchMe,
    logout,
    init,
  };
});
