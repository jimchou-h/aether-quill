<template>
  <div id="app">
    <header v-if="authStore.isAuthenticated" class="app-header">
      <div class="header-left">
        <router-link to="/projects" class="header-brand">Aether Quill</router-link>
      </div>
      <div class="header-right">
        <span class="user-name">{{ authStore.userName }}</span>
        <button class="logout-button" @click="handleLogout">退出登录</button>
      </div>
    </header>
    <main class="app-main">
      <router-view />
    </main>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from './stores/auth';

const router = useRouter();
const authStore = useAuthStore();

onMounted(() => {
  authStore.init();
});

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
