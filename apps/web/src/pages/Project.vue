<template>
  <div class="project-page">
    <aside class="project-sidebar">
      <nav>
        <router-link :to="`/projects/${projectId}/workbench`">写作工作台</router-link>
        <router-link :to="`/projects/${projectId}/knowledge`">知识库</router-link>
        <router-link :to="`/projects/${projectId}/settings`">设置</router-link>
      </nav>
    </aside>
    <main class="project-content">
      <router-view />
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';

const route = useRoute();
const projectId = computed(() => route.params.id as string);
</script>

<style scoped>
.project-page {
  display: flex;
  min-height: 100vh;
}
.project-sidebar {
  width: 200px;
  padding: 1rem;
  background: #f5f5f5;
}
.project-sidebar nav {
  display: flex;
  flex-direction: column;
}
.project-sidebar a {
  padding: 0.5rem;
  text-decoration: none;
  color: #333;
}
.project-sidebar a.router-link-active {
  background: #ddd;
  border-radius: 4px;
}
.project-content {
  flex: 1;
  padding: 1rem;
}
</style>
