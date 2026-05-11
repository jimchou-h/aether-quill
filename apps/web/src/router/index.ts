import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '../stores/auth';

const invalidProjectIdAliases = new Set([
  'workbench',
  'knowledge',
  'settings',
  'documents',
  'chapters',
  'members',
  'workspace',
  'export',
  'write',
]);

function isInvalidProjectId(projectId: unknown) {
  const normalized = String(projectId || '')
    .trim()
    .toLowerCase();
  return !normalized || invalidProjectIdAliases.has(normalized);
}

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      redirect: '/projects',
    },
    {
      path: '/login',
      name: 'login',
      component: () => import('../pages/Login.vue'),
    },
    {
      path: '/projects',
      name: 'projects',
      component: () => import('../pages/Projects.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/projects/:id',
      name: 'project',
      component: () => import('../pages/Project.vue'),
      meta: { requiresAuth: true },
      children: [
        {
          path: '',
          redirect: (to) => ({ name: 'workbench', params: { id: to.params.id } }),
        },
        {
          path: 'workbench',
          name: 'workbench',
          component: () => import('../pages/Workbench.vue'),
        },
        {
          path: 'knowledge',
          name: 'knowledge',
          component: () => import('../pages/Knowledge.vue'),
        },
        {
          path: 'settings',
          name: 'settings',
          component: () => import('../pages/Settings.vue'),
        },
        {
          path: 'chapters',
          name: 'chapters',
          component: () => import('../pages/Chapters.vue'),
        },
      ],
    },
  ],
});

router.beforeEach((to, from, next) => {
  const authStore = useAuthStore();
  if (to.meta.requiresAuth && !authStore.isAuthenticated) {
    next({ name: 'login' });
  } else if (to.params.id && isInvalidProjectId(to.params.id)) {
    next({
      name: 'projects',
      query: { invalidProjectId: String(to.params.id) },
    });
  } else if (to.name === 'login' && authStore.isAuthenticated) {
    next({ name: 'projects' });
  } else {
    next();
  }
});

export default router;
