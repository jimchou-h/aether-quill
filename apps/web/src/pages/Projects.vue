<script setup lang="ts">
import { onMounted, ref, shallowRef } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { apiClient, type ProjectItem } from '../services/api';
import { presentError, presentErrorFromCaught, presentSuccess } from '../utils/pageFeedback';

const router = useRouter();
const route = useRoute();

const projects = ref<ProjectItem[]>([]);
const loading = shallowRef(false);
const submitLoading = shallowRef(false);
const deletingProjectId = shallowRef<string | null>(null);
const errorMessage = shallowRef('');
const routeTipMessage = shallowRef('');

const newProjectName = shallowRef('');
const newProjectDescription = shallowRef('');

async function loadProjects() {
  loading.value = true;
  errorMessage.value = '';
  try {
    projects.value = await apiClient.getProjects();
  } catch (error) {
    errorMessage.value = presentErrorFromCaught(error, '加载项目失败');
  } finally {
    loading.value = false;
  }
}

function applyInvalidProjectRouteTip() {
  const invalidProjectId = route.query.invalidProjectId;
  if (typeof invalidProjectId !== 'string' || !invalidProjectId.trim()) {
    return;
  }

  routeTipMessage.value = presentError(
    `项目地址无效（${invalidProjectId}）。请先从项目列表进入具体项目。`
  );
  void router.replace({ name: 'projects' });
}

async function handleDeleteProject(project: ProjectItem) {
  if (!confirm(`确定删除「${project.name}」？此操作不可撤销。`)) {
    return;
  }

  deletingProjectId.value = project.id;
  errorMessage.value = '';
  try {
    await apiClient.deleteProject(project.id);
    projects.value = projects.value.filter((item) => item.id !== project.id);
    presentSuccess(`「${project.name}」已删除`);
  } catch (error) {
    errorMessage.value = presentErrorFromCaught(error, '删除项目失败');
  } finally {
    deletingProjectId.value = null;
  }
}

async function handleCreateProject() {
  if (!newProjectName.value.trim()) {
    errorMessage.value = presentError('请填写项目名称');
    return;
  }

  submitLoading.value = true;
  errorMessage.value = '';
  try {
    const project = await apiClient.createProject({
      name: newProjectName.value.trim(),
      description: newProjectDescription.value.trim(),
    });
    console.log(project);
    projects.value = [project, ...projects.value];
    newProjectName.value = '';
    newProjectDescription.value = '';
    presentSuccess(`项目「${project.name}」已创建`);
    await router.push(`/projects/${project.id}/workbench`);
  } catch (error) {
    errorMessage.value = presentErrorFromCaught(error, '创建项目失败');
  } finally {
    submitLoading.value = false;
  }
}

onMounted(() => {
  applyInvalidProjectRouteTip();
  void loadProjects();
});
</script>

<template>
  <div class="projects-page">
    <header class="projects-header">
      <h1 class="projects-title">我的小说项目</h1>
      <p class="projects-subtitle">每个项目都有独立的人物设定、知识库和写作上下文。</p>
    </header>

    <section class="create-card">
      <h2 class="card-title">新建项目</h2>
      <div class="field-group">
        <label class="field-label" for="project-name">项目名称</label>
        <input
          id="project-name"
          v-model="newProjectName"
          class="field-input"
          placeholder="例如：暮潮纪元"
        />
      </div>
      <div class="field-group">
        <label class="field-label" for="project-description">项目描述</label>
        <textarea
          id="project-description"
          v-model="newProjectDescription"
          class="field-textarea"
          placeholder="一句话说明这本小说的定位"
        />
      </div>
      <button class="primary-button" :disabled="submitLoading" @click="handleCreateProject">
        {{ submitLoading ? '创建中...' : '创建并进入工作台' }}
      </button>
    </section>

    <p v-if="routeTipMessage" class="message message-error">{{ routeTipMessage }}</p>
    <p v-if="errorMessage" class="message message-error">{{ errorMessage }}</p>
    <p v-if="loading" class="message">正在加载项目...</p>

    <section v-else class="project-list">
      <article v-for="project in projects" :key="project.id" class="project-card">
        <h3 class="project-title">{{ project.name }}</h3>
        <p class="project-description">{{ project.description || '暂无描述' }}</p>
        <div class="card-actions">
          <router-link class="link-button" :to="`/projects/${project.id}/workbench`"
            >进入写作</router-link
          >
          <router-link class="link-button" :to="`/projects/${project.id}/knowledge`"
            >知识库</router-link
          >
          <router-link class="link-button" :to="`/projects/${project.id}/settings`"
            >人物设定</router-link
          >
          <button
            type="button"
            class="danger-button"
            :disabled="deletingProjectId === project.id"
            @click="handleDeleteProject(project)"
          >
            {{ deletingProjectId === project.id ? '删除中...' : '删除' }}
          </button>
        </div>
      </article>
    </section>
  </div>
</template>

<style scoped>
.projects-page {
  padding: 2rem;
  max-width: 1100px;
  margin: 0 auto;
}

.projects-header {
  margin-bottom: 1.5rem;
}

.projects-title {
  margin-bottom: 0.25rem;
}

.projects-subtitle {
  color: #666;
}

.create-card {
  border: 1px solid #e5e5e5;
  border-radius: 8px;
  padding: 1rem;
  margin-bottom: 1rem;
  background: #fafafa;
}

.card-title {
  margin-bottom: 0.75rem;
}

.field-group {
  margin-bottom: 0.75rem;
}

.field-label {
  display: block;
  margin-bottom: 0.35rem;
  font-weight: 600;
}

.field-input,
.field-textarea {
  width: 100%;
  border: 1px solid #d9d9d9;
  border-radius: 6px;
  padding: 0.5rem 0.6rem;
  font-size: 0.95rem;
}

.field-textarea {
  min-height: 84px;
  resize: vertical;
}

.primary-button {
  border: none;
  background: #1d4ed8;
  color: #fff;
  border-radius: 6px;
  padding: 0.55rem 0.9rem;
  cursor: pointer;
}

.primary-button:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

.message {
  margin-bottom: 0.75rem;
  color: #555;
}

.message-error {
  color: #b42318;
}

.project-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 1rem;
}

.project-card {
  padding: 1rem;
  border: 1px solid #ddd;
  border-radius: 8px;
  background: #fff;
}

.project-title {
  margin-bottom: 0.35rem;
}

.project-description {
  color: #555;
  margin-bottom: 0.75rem;
}

.card-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.link-button {
  border: 1px solid #d9d9d9;
  border-radius: 6px;
  padding: 0.35rem 0.65rem;
  color: #1f2937;
  text-decoration: none;
}

.danger-button {
  border: 1px solid #fecdca;
  border-radius: 6px;
  padding: 0.35rem 0.65rem;
  background: #fff;
  color: #b42318;
  cursor: pointer;
}

.danger-button:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}
</style>
