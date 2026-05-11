/**
 * Prompt 配置版本管理
 * 支持 systemPromptText 字段的发布和回滚
 */

export type PromptConfigStatus = 'draft' | 'published' | 'archived';

export interface PromptConfigVersion {
  version: number;
  systemPromptText: string;
  createdAt: string;
  publishedAt?: string;
  isPublished: boolean;
}

export interface PromptConfig {
  id: string;
  projectId: string;
  systemPromptText: string;
  version: number;
  isPublished: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PromptConfigHistory {
  configId: string;
  versions: PromptConfigVersion[];
}

export interface PublishResult {
  configId: string;
  version: number;
  isPublished: boolean;
  publishedAt: string;
}

export interface RollbackResult {
  configId: string;
  currentVersion: number;
  previousVersion: number;
  rolledBackAt: string;
}

/**
 * Prompt 配置管理器
 */
export class PromptConfigManager {
  private configs: Map<string, PromptConfig> = new Map();
  private histories: Map<string, PromptConfigHistory> = new Map();

  /**
   * 创建新的 Prompt 配置
   */
  create(projectId: string, systemPromptText: string): PromptConfig {
    const existing = this.getByProjectId(projectId);
    if (existing) {
      throw new Error('Prompt config already exists for this project');
    }

    const config: PromptConfig = {
      id: crypto.randomUUID(),
      projectId,
      systemPromptText,
      version: 1,
      isPublished: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.configs.set(config.id, config);

    const history: PromptConfigHistory = {
      configId: config.id,
      versions: [
        {
          version: 1,
          systemPromptText,
          createdAt: config.createdAt,
          isPublished: false,
        },
      ],
    };
    this.histories.set(config.id, history);

    return config;
  }

  /**
   * 获取配置
   */
  getById(configId: string): PromptConfig | undefined {
    return this.configs.get(configId);
  }

  /**
   * 获取项目对应的配置
   */
  getByProjectId(projectId: string): PromptConfig | undefined {
    for (const config of this.configs.values()) {
      if (config.projectId === projectId) {
        return config;
      }
    }
    return undefined;
  }

  /**
   * 获取项目对应的配置（支持发布版本或草稿）
   */
  getByProjectIdOrLatest(
    projectId: string,
    publishedOnly: boolean = false
  ): PromptConfig | undefined {
    const config = this.getByProjectId(projectId);
    if (!config) return undefined;

    if (publishedOnly) {
      const history = this.histories.get(config.id);
      const publishedVersion = history?.versions.find((v) => v.isPublished);
      if (publishedVersion) {
        return {
          ...config,
          systemPromptText: publishedVersion.systemPromptText,
          version: publishedVersion.version,
          isPublished: true,
        };
      }
    }

    return config;
  }

  /**
   * 更新配置（保存为草稿）
   */
  update(configId: string, systemPromptText: string): PromptConfig {
    const config = this.configs.get(configId);
    if (!config) {
      throw new Error('Prompt config not found');
    }

    const history = this.histories.get(configId);

    config.systemPromptText = systemPromptText;
    config.version += 1;
    config.updatedAt = new Date().toISOString();
    config.isPublished = false;

    if (history) {
      history.versions.push({
        version: config.version,
        systemPromptText,
        createdAt: config.updatedAt,
        isPublished: false,
      });
    }

    return config;
  }

  /**
   * 发布配置
   */
  publish(configId: string): PublishResult {
    const config = this.configs.get(configId);
    if (!config) {
      throw new Error('Prompt config not found');
    }

    const history = this.histories.get(configId);
    if (!history) {
      throw new Error('Prompt config history not found');
    }

    for (const v of history.versions) {
      v.isPublished = false;
    }

    const currentVersion = history.versions.find((v) => v.version === config.version);
    if (currentVersion) {
      currentVersion.isPublished = true;
      currentVersion.publishedAt = new Date().toISOString();
    }

    config.isPublished = true;
    config.updatedAt = new Date().toISOString();

    return {
      configId: config.id,
      version: config.version,
      isPublished: true,
      publishedAt: config.updatedAt,
    };
  }

  /**
   * 回滚到指定版本
   */
  rollback(configId: string, targetVersion?: number): RollbackResult {
    const config = this.configs.get(configId);
    if (!config) {
      throw new Error('Prompt config not found');
    }

    const history = this.histories.get(configId);
    if (!history) {
      throw new Error('Prompt config history not found');
    }

    if (history.versions.length < 2) {
      throw new Error('No previous version to rollback to');
    }

    const previousVersion = targetVersion
      ? history.versions.find((v) => v.version === targetVersion)
      : history.versions[history.versions.length - 2];

    if (!previousVersion) {
      throw new Error('Target version not found');
    }

    const currentVersion = config.version;
    const newVersion = currentVersion + 1;

    config.systemPromptText = previousVersion.systemPromptText;
    config.version = newVersion;
    config.updatedAt = new Date().toISOString();
    config.isPublished = false;

    history.versions.push({
      version: newVersion,
      systemPromptText: previousVersion.systemPromptText,
      createdAt: config.updatedAt,
      isPublished: false,
    });

    return {
      configId: config.id,
      currentVersion: newVersion,
      previousVersion: previousVersion.version,
      rolledBackAt: config.updatedAt,
    };
  }

  /**
   * 获取配置历史
   */
  getHistory(configId: string): PromptConfigHistory | undefined {
    return this.histories.get(configId);
  }

  /**
   * 删除配置
   */
  delete(configId: string): void {
    this.configs.delete(configId);
    this.histories.delete(configId);
  }

  /**
   * 检查是否有未发布的更改
   */
  hasUnpublishedChanges(configId: string): boolean {
    const config = this.configs.get(configId);
    if (!config) return false;

    const history = this.histories.get(configId);
    if (!history) return false;

    const publishedVersion = history.versions.find((v) => v.isPublished);
    if (!publishedVersion) return config.version > 1;

    const latestVersion = history.versions[history.versions.length - 1];
    return (
      latestVersion.version !== publishedVersion.version ||
      latestVersion.systemPromptText !== publishedVersion.systemPromptText
    );
  }
}

export const promptConfigManager = new PromptConfigManager();
