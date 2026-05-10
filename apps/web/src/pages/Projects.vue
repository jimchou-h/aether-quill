<template>
  <div class="projects-page">
    <h1>我的项目</h1>
    <div class="project-list">
      <div v-for="project in projects" :key="project.id" class="project-card">
        <h3>{{ project.name }}</h3>
        <p>{{ project.description }}</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';

const projects = ref([
  { id: '1', name: '示例项目', description: '这是一个示例项目' }
]);
</script>

<style scoped>
.projects-page {
  padding: 2rem;
}
.project-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 1rem;
  margin-top: 1rem;
}
.project-card {
  padding: 1rem;
  border: 1px solid #ddd;
  border-radius: 8px;
}
</style>
