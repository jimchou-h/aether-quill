// @aether-quill/config
// 项目配置管理

export interface AppConfig {
  env: 'development' | 'staging' | 'production';
  port: number;
}

export const config: AppConfig = {
  env: (process.env.NODE_ENV as 'development' | 'staging' | 'production') || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
};
