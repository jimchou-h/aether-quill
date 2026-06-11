<template>
  <a-config-provider :locale="antdLocale" :theme="antdTheme">
    <div id="app">
      <header v-if="authStore.isAuthenticated" class="app-header">
        <div class="header-left">
          <router-link to="/projects" class="header-brand" aria-label="返回项目列表">
            <span class="brand-mark" aria-hidden="true">Q</span>
            <span class="brand-text">Aether Quill</span>
          </router-link>
        </div>
        <div class="header-right">
          <span class="user-name">{{ authStore.userName }}</span>
          <button class="aq-btn aq-btn-ghost logout-button" type="button" @click="handleLogout">
            退出登录
          </button>
        </div>
      </header>
      <main class="app-main">
        <router-view />
      </main>
    </div>
  </a-config-provider>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';
import zhCN from 'ant-design-vue/es/locale/zh_CN';
import { useRouter } from 'vue-router';
import { useAuthStore } from './stores/auth';

const antdLocale = zhCN;

const antdTheme = {
  token: {
    colorPrimary: '#4f46e5',
    borderRadius: 8,
    fontFamily: "'Noto Sans SC', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
};

/** 路由实例 */
const router = useRouter();
/** 认证状态管理 */
const authStore = useAuthStore();

const CLICK_REFRESH_INTERVAL_MS = 30_000;
let lastClickRefreshAt = 0;

function onGlobalClick() {
  if (!authStore.isAuthenticated) {
    return;
  }

  const now = Date.now();
  if (now - lastClickRefreshAt < CLICK_REFRESH_INTERVAL_MS) {
    return;
  }

  lastClickRefreshAt = now;
  void authStore.ensureFreshSession();
}

/**
 * 组件挂载时初始化认证状态
 */
onMounted(() => {
  authStore.init();
  document.addEventListener('click', onGlobalClick, true);
});

onUnmounted(() => {
  document.removeEventListener('click', onGlobalClick, true);
});

/**
 * 处理用户登出
 */
function handleLogout() {
  authStore.logout();
  router.push('/login');
}
</script>

<style scoped>
.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: var(--aq-header-height);
  padding: 0 1.5rem;
  background: var(--aq-surface);
  border-bottom: 1px solid var(--aq-border);
  position: sticky;
  top: 0;
  z-index: 100;
  box-shadow: var(--aq-shadow-sm);
}

.header-left {
  display: flex;
  align-items: center;
}

.header-brand {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  text-decoration: none;
  color: var(--aq-text);
  transition: opacity var(--aq-transition);
}

.header-brand:hover {
  opacity: 0.85;
}

.brand-mark {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  border-radius: var(--aq-radius-xs);
  background: linear-gradient(135deg, var(--aq-primary) 0%, #6366f1 100%);
  color: var(--aq-text-inverse);
  font-family: var(--aq-font-display);
  font-size: 1rem;
  font-weight: 700;
  line-height: 1;
}

.brand-text {
  font-family: var(--aq-font-display);
  font-size: 1.05rem;
  font-weight: 700;
  letter-spacing: -0.01em;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.user-name {
  font-size: 0.875rem;
  color: var(--aq-text-secondary);
}

.logout-button {
  font-size: 0.85rem;
}

.app-main {
  min-height: calc(100vh - var(--aq-header-height));
}
</style>
