import type { App } from 'vue';
import Antd from 'ant-design-vue';
import 'ant-design-vue/dist/reset.css';

export function setupAntd(app: App): void {
  app.use(Antd);
}
