import { ModelProvider, ProviderType, ProviderConfig, ProviderFactory } from './types';
import { DeepSeekFactory } from './deepseek';
import { SiliconFlowFactory } from './siliconflow';
import { createEmbeddingProviderFromEnv } from './embedding/factory';
import type { EmbeddingProvider } from './embedding/types';

let embeddingProviderSingleton: EmbeddingProvider | null = null;

/**
 * 获取（并缓存）Embedding 供应商实例，配置来源为环境变量。
 */
export function getEmbeddingProvider(): EmbeddingProvider {
  if (!embeddingProviderSingleton) {
    embeddingProviderSingleton = createEmbeddingProviderFromEnv();
  }
  return embeddingProviderSingleton;
}

/**
 * 供应商注册表
 */
const providerFactories: Record<ProviderType, ProviderFactory> = {
  deepseek: new DeepSeekFactory(),
  siliconflow: new SiliconFlowFactory(),
};

/**
 * 获取所有支持的供应商类型
 */
export function getSupportedProviders(): ProviderType[] {
  return Object.keys(providerFactories) as ProviderType[];
}

/**
 * 检查供应商类型是否支持
 */
export function isProviderSupported(type: string): type is ProviderType {
  return type in providerFactories;
}

/**
 * 创建供应商适配器
 */
export function createProvider(type: ProviderType, config: ProviderConfig): ModelProvider {
  const factory = providerFactories[type];
  if (!factory) {
    throw new Error(`Unsupported provider type: ${type}`);
  }
  return factory.create(config);
}

/**
 * 供应商管理器
 */
export class ProviderManager {
  private providers: Map<ProviderType, ModelProvider> = new Map();

  /**
   * 注册供应商
   */
  register(type: ProviderType, config: ProviderConfig): void {
    const provider = createProvider(type, config);
    this.providers.set(type, provider);
  }

  /**
   * 获取供应商
   */
  get(type: ProviderType): ModelProvider | undefined {
    return this.providers.get(type);
  }

  /**
   * 删除供应商
   */
  unregister(type: ProviderType): void {
    this.providers.delete(type);
  }

  /**
   * 获取所有已注册的供应商类型
   */
  getRegisteredTypes(): ProviderType[] {
    return Array.from(this.providers.keys());
  }

  /**
   * 检查供应商是否已注册
   */
  isRegistered(type: ProviderType): boolean {
    return this.providers.has(type);
  }

  /**
   * 使用指定供应商生成内容
   */
  async generate(
    type: ProviderType,
    request: Parameters<ModelProvider['generate']>[0]
  ): Promise<ReturnType<ModelProvider['generate']>> {
    const provider = this.get(type);
    if (!provider) {
      throw new Error(`Provider not registered: ${type}`);
    }
    return provider.generate(request);
  }

  /**
   * 使用指定供应商流式生成内容
   */
  streamGenerate(
    type: ProviderType,
    request: Parameters<ModelProvider['streamGenerate']>[0]
  ): ReturnType<ModelProvider['streamGenerate']> {
    const provider = this.get(type);
    if (!provider) {
      throw new Error(`Provider not registered: ${type}`);
    }
    return provider.streamGenerate(request);
  }
}
