import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '../stores/auth';

/**
 * 无效的项目ID别名集合
 * 这些名称被保留用于子路由路径，不能作为项目ID使用
 */
const invalidProjectIdAliases = new Set([
  'workbench',
  'knowledge',
  'settings',
  'documents',
  'chapters',
  'personas',
  'relation-events',
  'members',
  'workspace',
  'export',
  'write',
]);

/**
 * 检查项目ID是否无效
 * @param {unknown} projectId - 项目ID
 * @returns {boolean} 是否无效
 */
function isInvalidProjectId(projectId: unknown) {
  const normalized = String(projectId || '')
    .trim()
    .toLowerCase();
  return !normalized || invalidProjectIdAliases.has(normalized);
}

/**
 * 创建路由实例
 */
const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    // 根路径重定向到项目列表
    {
      path: '/',
      redirect: '/projects',
    },
    // 登录页面
    {
      path: '/login',
      name: 'login',
      component: () => import('../pages/Login.vue'),
    },
    // 项目列表页面（需要认证）
    {
      path: '/projects',
      name: 'projects',
      component: () => import('../pages/Projects.vue'),
      meta: { requiresAuth: true },
    },
    // 项目详情页面（需要认证）
    {
      path: '/projects/:id',
      name: 'project',
      component: () => import('../pages/Project.vue'),
      meta: { requiresAuth: true },
      children: [
        // 默认重定向到写作工作台
        {
          path: '',
          redirect: (to) => ({ name: 'workbench', params: { id: to.params.id } }),
        },
        // 写作工作台
        {
          path: 'workbench',
          name: 'workbench',
          component: () => import('../pages/Workbench.vue'),
        },
        // 知识库管理
        {
          path: 'knowledge',
          name: 'knowledge',
          component: () => import('../pages/Knowledge.vue'),
        },
        {
          path: 'personas',
          name: 'personas',
          component: () => import('../pages/Persona.vue'),
        },
        {
          path: 'relation-events',
          name: 'relation-events',
          component: () => import('../pages/RelationEvents.vue'),
        },
        // 项目设置
        {
          path: 'settings',
          name: 'settings',
          component: () => import('../pages/Settings.vue'),
        },
        // 章节管理
        {
          path: 'chapters',
          name: 'chapters',
          component: () => import('../pages/Chapters.vue'),
        },
      ],
    },
  ],
});

/**
 * 全局路由守卫
 * 处理认证检查和无效项目ID拦截
 */
router.beforeEach((to, from, next) => {
  const authStore = useAuthStore();

  // 检查是否需要认证
  if (to.meta.requiresAuth && !authStore.isAuthenticated) {
    next({ name: 'login' });
  }
  // 检查项目ID是否无效
  else if (to.params.id && isInvalidProjectId(to.params.id)) {
    next({
      name: 'projects',
      query: { invalidProjectId: String(to.params.id) },
    });
  }
  // 已认证用户访问登录页，重定向到项目列表
  else if (to.name === 'login' && authStore.isAuthenticated) {
    next({ name: 'projects' });
  }
  // 正常导航
  else {
    next();
  }
});

export default router;
