<script setup lang="ts">
import GlobalGenerationPreferences from '../components/settings/GlobalGenerationPreferences.vue';
</script>

<template>
  <div class="account-settings-page">
    <h1 class="page-title">账户设置</h1>
    <p class="page-subtitle">管理跨项目生效的全局生成偏好。</p>
    <GlobalGenerationPreferences />
  </div>
</template>

<style scoped>
.account-settings-page {
  max-width: 720px;
  margin: 0 auto;
  padding: 1.5rem var(--aq-space-lg, 1.5rem) 2.5rem;
}

.page-title {
  margin: 0 0 0.35rem;
  font-size: 1.5rem;
  font-weight: 700;
}

.page-subtitle {
  margin: 0 0 1.25rem;
  color: var(--aq-text-secondary);
  font-size: 0.9rem;
}
</style>
