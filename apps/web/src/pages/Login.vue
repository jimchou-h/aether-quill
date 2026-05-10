<template>
  <div class="login-page">
    <h1>Aether Quill</h1>
    <p>小说写作助手</p>
    <button @click="handleLogin">登录</button>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router';

const router = useRouter();

const handleLogin = () => {
  router.push('/projects');
};
</script>

<style scoped>
.login-page {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
}
</style>
