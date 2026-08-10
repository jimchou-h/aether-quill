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

export { loadEnv } from './load-env';
export {
  assertRagInfrastructureEnv,
  getResolvedRagInfrastructureEnv,
  type RagServiceRole,
  type ResolvedRagInfrastructureEnv,
} from './rag-infrastructure-env';
export * from './content-safety';
export * from './writing-style-samples';
export * from './generation-profile';
