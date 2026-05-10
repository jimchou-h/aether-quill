import { createRouter, createWebHistory } from 'vue-router';

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      redirect: '/projects'
    },
    {
      path: '/login',
      name: 'login',
      component: () => import('../pages/Login.vue')
    },
    {
      path: '/projects',
      name: 'projects',
      component: () => import('../pages/Projects.vue')
    },
    {
      path: '/projects/:id',
      name: 'project',
      component: () => import('../pages/Project.vue'),
      children: [
        {
          path: '',
          redirect: (to) => ({ name: 'workbench', params: { id: to.params.id } })
        },
        {
          path: 'workbench',
          name: 'workbench',
          component: () => import('../pages/Workbench.vue')
        },
        {
          path: 'knowledge',
          name: 'knowledge',
          component: () => import('../pages/Knowledge.vue')
        },
        {
          path: 'settings',
          name: 'settings',
          component: () => import('../pages/Settings.vue')
        }
      ]
    }
  ]
});

export default router;
