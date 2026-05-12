import { createApp } from 'vue';
import { createPinia } from 'pinia';
import router from './router';
import App from './App.vue';
import { presentErrorFromCaught } from './utils/pageFeedback';
import './styles/main.css';

const app = createApp(App);

app.use(createPinia());
app.use(router);

app.config.errorHandler = (error) => {
  presentErrorFromCaught(error, '页面发生意外错误');
};

window.addEventListener('unhandledrejection', (event) => {
  presentErrorFromCaught(event.reason, '请求处理失败');
});

app.mount('#app');
