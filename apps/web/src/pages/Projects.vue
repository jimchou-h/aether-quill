<script setup lang="ts">
import { onMounted, ref, shallowRef } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { PlusOutlined } from '@ant-design/icons-vue';
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
  <div class="aq-page projects-page">
    <header class="aq-page-header">
      <h1 class="aq-page-title">我的小说项目</h1>
      <p class="aq-page-subtitle">每个项目都有独立的人物设定、知识库和写作上下文。</p>
    </header>

    <section class="aq-card create-card">
      <h2 class="aq-card-title">
        <PlusOutlined aria-hidden="true" />
        新建项目
      </h2>
      <div class="aq-field-group">
        <label class="aq-field-label" for="project-name">项目名称</label>
        <input
          id="project-name"
          v-model="newProjectName"
          class="aq-field-input"
          placeholder="例如：暮潮纪元"
        />
      </div>
      <div class="aq-field-group">
        <label class="aq-field-label" for="project-description">项目描述</label>
        <textarea
          id="project-description"
          v-model="newProjectDescription"
          class="aq-field-textarea"
          placeholder="一句话说明这本小说的定位"
        />
      </div>
      <button
        class="aq-btn aq-btn-primary"
        type="button"
        :disabled="submitLoading"
        @click="handleCreateProject"
      >
        {{ submitLoading ? '创建中...' : '创建并进入工作台' }}
      </button>
    </section>

    <p v-if="routeTipMessage" class="aq-message aq-message--error">{{ routeTipMessage }}</p>
    <p v-if="errorMessage" class="aq-message aq-message--error">{{ errorMessage }}</p>

    <div v-if="loading" class="loading-state">
      <div class="loading-spinner" aria-hidden="true" />
      <p>正在加载项目...</p>
    </div>

    <section v-else-if="projects.length === 0" class="aq-empty">
      <p>还没有项目，在上方创建你的第一本小说吧。</p>
    </section>

    <section v-else class="project-list">
      <article v-for="project in projects" :key="project.id" class="project-card">
        <div class="project-card-body">
          <h3 class="project-title">{{ project.name }}</h3>
          <p class="project-description">{{ project.description || '暂无描述' }}</p>
        </div>
        <div class="card-actions">
          <router-link
            class="aq-btn aq-btn-primary"
            :to="`/projects/${project.id}/workbench`"
          >
            进入写作
          </router-link>
          <router-link class="aq-btn aq-btn-link" :to="`/projects/${project.id}/knowledge`">
            知识库
          </router-link>
          <router-link class="aq-btn aq-btn-link" :to="`/projects/${project.id}/personas`">
            人物设定
          </router-link>
          <button
            type="button"
            class="aq-btn aq-btn-danger"
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
  padding-top: 2rem;
  padding-bottom: 3rem;
}

.create-card {
  margin-bottom: 1.25rem;
}

.create-card .aq-card-title {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  padding: 3rem 0;
  color: var(--aq-text-secondary);
  font-size: 0.9rem;
}

.loading-spinner {
  width: 28px;
  height: 28px;
  border: 3px solid var(--aq-border);
  border-top-color: var(--aq-primary);
  border-radius: 50%;
  animation: spin 0.75s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.project-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 1rem;
}

.project-card {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 1rem;
  padding: 1.25rem;
  border: 1px solid var(--aq-border);
  border-radius: var(--aq-radius-sm);
  background: var(--aq-surface);
  box-shadow: var(--aq-shadow-sm);
  transition:
    border-color var(--aq-transition),
    box-shadow var(--aq-transition);
}

.project-card:hover {
  border-color: var(--aq-primary-muted);
  box-shadow: var(--aq-shadow);
}

.project-title {
  margin: 0 0 0.35rem;
  font-size: 1.05rem;
  font-weight: 600;
  color: var(--aq-text);
}

.project-description {
  margin: 0;
  color: var(--aq-text-secondary);
  font-size: 0.875rem;
  line-height: 1.55;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.card-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

@media (prefers-reduced-motion: reduce) {
  .loading-spinner {
    animation: none;
  }
}
</style>
