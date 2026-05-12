<template>
  <div id="app">
    <!-- 应用头部导航 -->
    <header v-if="authStore.isAuthenticated" class="app-header">
      <div class="header-left">
        <router-link to="/projects" class="header-brand">Aether Quill</router-link>
      </div>
      <div class="header-right">
        <span class="user-name">{{ authStore.userName }}</span>
        <button class="logout-button" @click="handleLogout">退出登录</button>
      </div>
    </header>
    <!-- 主内容区域 -->
    <main class="app-main">
      <router-view />
    </main>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from './stores/auth';

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
  height: 56px;
  padding: 0 1.5rem;
  background: #fff;
  border-bottom: 1px solid #e5e5e5;
  position: sticky;
  top: 0;
  z-index: 100;
}

.header-left {
  display: flex;
  align-items: center;
}

.header-brand {
  font-size: 1.1rem;
  font-weight: 700;
  color: #1a1a2e;
  text-decoration: none;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.user-name {
  font-size: 0.9rem;
  color: #555;
}

.logout-button {
  border: 1px solid #d9d9d9;
  background: #fff;
  color: #555;
  border-radius: 6px;
  padding: 0.35rem 0.75rem;
  font-size: 0.85rem;
  cursor: pointer;
  transition: all 0.2s;
}

.logout-button:hover {
  border-color: #b42318;
  color: #b42318;
}

.app-main {
  min-height: calc(100vh - 56px);
}
</style>
