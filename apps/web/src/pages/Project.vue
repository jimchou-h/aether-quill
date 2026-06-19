<template>
  <div class="project-page">
    <aside class="project-sidebar" aria-label="项目导航">
      <router-link to="/projects" class="sidebar-back aq-btn aq-btn-ghost">
        <ArrowLeftOutlined aria-hidden="true" />
        <span>全部项目</span>
      </router-link>

      <nav class="sidebar-nav">
        <router-link
          v-for="item in navItems"
          :key="item.path"
          :to="`/projects/${projectId}/${item.path}`"
          class="sidebar-link"
        >
          <component :is="item.icon" class="sidebar-icon" aria-hidden="true" />
          <span>{{ item.label }}</span>
        </router-link>
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
import {
  ArrowLeftOutlined,
  BookOutlined,
  ClusterOutlined,
  EditOutlined,
  FileTextOutlined,
  SettingOutlined,
  TeamOutlined,
} from '@ant-design/icons-vue';

const route = useRoute();
const projectId = computed(() => route.params.id as string);

const navItems = [
  { path: 'workbench', label: '写作工作台', icon: EditOutlined },
  { path: 'knowledge', label: '知识库', icon: BookOutlined },
  { path: 'personas', label: '人物设定', icon: TeamOutlined },
  { path: 'relation-events', label: '关系事件', icon: ClusterOutlined },
  { path: 'chapters', label: '章节', icon: FileTextOutlined },
  { path: 'settings', label: '设置', icon: SettingOutlined },
];
</script>

<style scoped>
.project-page {
  display: flex;
  min-height: calc(100vh - var(--aq-header-height));
}

.project-sidebar {
  width: var(--aq-sidebar-width);
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: var(--aq-space-sm);
  padding: var(--aq-space-md) 0.75rem;
  background: var(--aq-surface);
  border-right: 2px solid var(--aq-border);
}

.sidebar-back {
  justify-content: flex-start;
  width: 100%;
  padding: 0.45rem 0.65rem;
  font-size: 0.8125rem;
  color: var(--aq-text-secondary);
}

.sidebar-back:hover {
  color: var(--aq-primary);
}

.sidebar-nav {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.sidebar-link {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.6rem 0.75rem;
  border-radius: var(--aq-radius-xs);
  text-decoration: none;
  color: var(--aq-text-secondary);
  font-size: 0.875rem;
  font-weight: 500;
  transition:
    background var(--aq-transition-fast),
    color var(--aq-transition-fast);
  cursor: pointer;
}

.sidebar-link:hover {
  background: var(--aq-bg-subtle);
  color: var(--aq-text);
}

.sidebar-link.router-link-active {
  background: var(--aq-primary);
  color: var(--aq-text-inverse);
  font-weight: 600;
}

.sidebar-link.router-link-active .sidebar-icon {
  color: var(--aq-text-inverse);
}

.sidebar-icon {
  font-size: 1rem;
  flex-shrink: 0;
}

.project-content {
  flex: 1;
  min-width: 0;
  padding: 1.25rem 1.5rem;
  background: var(--aq-bg);
}

@media (max-width: 768px) {
  .project-page {
    flex-direction: column;
  }

  .project-sidebar {
    width: 100%;
    border-right: none;
    border-bottom: 1px solid var(--aq-border);
    padding: 0.75rem;
  }

  .sidebar-nav {
    flex-direction: row;
    flex-wrap: wrap;
    gap: 0.35rem;
  }

  .sidebar-link {
    padding: 0.45rem 0.65rem;
    font-size: 0.8125rem;
  }

  .sidebar-back {
    display: none;
  }

  .project-content {
    padding: 1rem;
  }
}
</style>
