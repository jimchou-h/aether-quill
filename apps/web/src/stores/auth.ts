import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { apiClient } from '../services/api';

const ACCESS_REFRESH_THRESHOLD_SECONDS = 5 * 60;

let refreshInFlight: Promise<boolean> | null = null;

function getTokenExpirySeconds(accessToken: string): number | null {
  const parts = accessToken.split('.');
  if (parts.length < 2) {
    return null;
  }

  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))) as {
      exp?: unknown;
    };
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

function isAccessTokenNearExpiry(
  accessToken: string,
  thresholdSeconds = ACCESS_REFRESH_THRESHOLD_SECONDS
): boolean {
  const exp = getTokenExpirySeconds(accessToken);
  if (exp === null) {
    return false;
  }

  return exp - Math.floor(Date.now() / 1000) <= thresholdSeconds;
}

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
   * 轮换 access / refresh token
   */
  async function refreshSession(): Promise<boolean> {
    if (!refreshTokenValue.value) {
      return false;
    }

    if (!refreshInFlight) {
      refreshInFlight = (async () => {
        try {
          const data = await apiClient.auth.refresh({
            refreshToken: refreshTokenValue.value,
          });
          token.value = data.accessToken || '';
          refreshTokenValue.value = data.refreshToken || '';
          localStorage.setItem('token', token.value);
          localStorage.setItem('refreshToken', refreshTokenValue.value);
          return true;
        } catch {
          logout();
          return false;
        } finally {
          refreshInFlight = null;
        }
      })();
    }

    return refreshInFlight;
  }

  /**
   * Access 临近过期时续期
   */
  async function ensureFreshSession(): Promise<void> {
    if (!token.value || !refreshTokenValue.value) {
      return;
    }

    if (!isAccessTokenNearExpiry(token.value)) {
      return;
    }

    await refreshSession();
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
    refreshSession,
    ensureFreshSession,
    logout,
    init,
  };
});
