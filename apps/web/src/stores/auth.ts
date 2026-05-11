import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { apiClient } from '../services/api';

export const useAuthStore = defineStore('auth', () => {
  const token = ref(localStorage.getItem('token') || '');
  const refreshTokenValue = ref(localStorage.getItem('refreshToken') || '');
  const user = ref<{ userId: string; email: string; name: string } | null>(null);

  const isAuthenticated = computed(() => !!token.value);
  const userName = computed(() => user.value?.name || '');

  async function login(email: string, password: string) {
    const response = (await apiClient.auth.login({ email, password })) as any;
    const data = response?.data ?? response;
    token.value = data.accessToken || data.token || '';
    refreshTokenValue.value = data.refreshToken || '';
    localStorage.setItem('token', token.value);
    localStorage.setItem('refreshToken', refreshTokenValue.value);
    user.value = data.user || null;
  }

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

  function logout() {
    token.value = '';
    refreshTokenValue.value = '';
    user.value = null;
    localStorage.removeItem('token');
    localStorage.removeItem('refreshToken');
  }

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
