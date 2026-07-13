import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleInit,
  forwardRef,
} from '@nestjs/common';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { ProjectsService } from '../projects/projects.service';
import { PrismaService } from '../../prisma/prisma.service';
import { usePostgresPersistence } from '../../persistence/use-postgres';
import {
  loadPromptTemplatesFromPostgres,
  syncPromptTemplatesToPostgres,
  type PersistedPromptTemplatesPayload,
  type RestoredPromptTemplatesState,
} from '../../persistence/prompt-templates-pg-sync';
import {
  TemplateRecord,
  TemplateVersion,
  PublishResult,
  TemplateCategory,
} from './prompt-templates.entity';

interface PersistedTemplateState {
  templates: Array<{
    id: string;
    projectId: string;
    name: string;
    category: TemplateCategory;
    content: string;
    version: number;
    isPublished: boolean;
    createdAt: string;
    updatedAt: string;
  }>;
  versions: Record<
    string,
    Array<{
      version: number;
      content: string;
      createdAt: string;
      isPublished: boolean;
    }>
  >;
}

const DEFAULT_TEMPLATES: Array<{ name: string; category: TemplateCategory; content: string }> = [
  {
    name: '系统默认模板',
    category: 'system',
    content: '你是一位专业的小说写作助手。请帮助用户进行小说创作，保持逻辑连贯和设定一致性。',
  },
  {
    name: '章节写作模板',
    category: 'chapter',
    content:
      '撰写第{chapterNo}章正文。\n写作目标：{goal}\n叙事视角：{pov}\n说明：RAG Orchestrator 会将项目 systemPrompt、人物、大纲与近期章节摘要注入【叙事上下文】，将知识库向量检索结果注入【检索证据】；本模板仅描述章节任务骨架。\n字数期望：{targetWords}',
  },
  {
    name: '人物模板-基础版',
    category: 'persona',
    content: '角色身份：\n角色语气：\n角色禁忌：\n角色关系：',
  },
];

@Injectable()
export class PromptTemplatesService implements OnModuleInit {
  private readonly storagePath = join(resolve(process.cwd()), 'data', 'prompt-templates.json');

  private readonly templates: TemplateRecord[] = [];
  private readonly versions = new Map<string, TemplateVersion[]>();

  constructor(
    @Inject(forwardRef(() => ProjectsService))
    private readonly projectsService: ProjectsService,
    private readonly prisma: PrismaService
  ) {
    if (usePostgresPersistence()) {
      return;
    }
    const restored = this.restoreStateFromDisk();
    if (restored) {
      this.applyRestored(restored);
    }
  }

  async onModuleInit() {
    await this.projectsService.persistenceReady;
    if (!usePostgresPersistence()) {
      return;
    }
    try {
      const fromPg = await loadPromptTemplatesFromPostgres(this.prisma);
      if (fromPg) {
        this.applyRestored(fromPg);
      }
    } catch (err) {
      console.error('[persistence] prompt-templates PG 初始化失败', err);
    }
  }

  private applyRestored(restored: RestoredPromptTemplatesState) {
    this.templates.splice(0, this.templates.length, ...restored.templates);
    this.versions.clear();
    this.hydrateMap(this.versions, restored.versions);
  }

  findByProject(projectId: string): TemplateRecord[] {
    this.projectsService.findOne(projectId);
    return this.templates.filter((t) => t.projectId === projectId);
  }

  /** 运行时注入 orchestrator 的项目级 systemPromptText（优先 system 模板，回退 settings） */
  resolveProjectSystemPromptText(projectId: string): string {
    this.projectsService.findOne(projectId);
    const systemTemplate = this.templates.find(
      (t) => t.projectId === projectId && t.category === 'system'
    );
    if (systemTemplate?.content?.trim()) {
      return systemTemplate.content.trim();
    }
    return this.projectsService.getSettings(projectId).systemPromptText.trim();
  }

  private syncSystemPromptToProjectSettings(projectId: string, tmpl: TemplateRecord): void {
    if (tmpl.category !== 'system') {
      return;
    }
    const content = tmpl.content?.trim();
    if (!content) {
      return;
    }
    this.projectsService.updateSettings(projectId, { systemPromptText: content });
  }

  findById(projectId: string, templateId: string): TemplateRecord {
    this.projectsService.findOne(projectId);
    const tmpl = this.templates.find((t) => t.id === templateId && t.projectId === projectId);
    if (!tmpl) {
      throw new NotFoundException(`未找到模板: ${templateId}`);
    }
    return tmpl;
  }

  create(
    projectId: string,
    payload: { name: string; category: TemplateCategory; content: string }
  ): TemplateRecord {
    this.projectsService.findOne(projectId);

    const name = payload.name?.trim();
    const content = payload.content?.trim();
    if (!name) throw new BadRequestException('name 不能为空');
    if (!content) throw new BadRequestException('content 不能为空');

    const now = new Date();
    const tmpl: TemplateRecord = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      projectId,
      name,
      category: payload.category || 'custom',
      content,
      version: 1,
      isPublished: false,
      createdAt: now,
      updatedAt: now,
    };

    this.templates.push(tmpl);
    this.versions.set(tmpl.id, [
      {
        version: 1,
        content,
        createdAt: now,
        isPublished: false,
      },
    ]);
    this.persistState();
    this.syncSystemPromptToProjectSettings(projectId, tmpl);
    return tmpl;
  }

  initDefaults(projectId: string): TemplateRecord[] {
    const created: TemplateRecord[] = [];
    for (const def of DEFAULT_TEMPLATES) {
      const existing = this.templates.find(
        (t) => t.projectId === projectId && t.category === def.category && t.name === def.name
      );
      if (!existing) {
        created.push(this.create(projectId, def));
      }
    }
    return created;
  }

  update(
    projectId: string,
    templateId: string,
    payload: { name?: string; content?: string }
  ): TemplateRecord {
    const tmpl = this.findById(projectId, templateId);

    const now = new Date();
    if (payload.name !== undefined) tmpl.name = payload.name.trim() || tmpl.name;
    if (payload.content !== undefined) tmpl.content = payload.content;

    tmpl.version += 1;
    tmpl.isPublished = false;
    tmpl.updatedAt = now;

    const tmplVersions = this.versions.get(templateId) || [];
    tmplVersions.push({
      version: tmpl.version,
      content: tmpl.content,
      createdAt: now,
      isPublished: false,
    });
    this.versions.set(templateId, tmplVersions);

    this.persistState();
    this.syncSystemPromptToProjectSettings(projectId, tmpl);
    return tmpl;
  }

  publish(projectId: string, templateId: string): PublishResult {
    const tmpl = this.findById(projectId, templateId);
    const tmplVersions = this.versions.get(templateId) || [];

    for (const v of tmplVersions) {
      v.isPublished = false;
    }

    const currentVersion = tmplVersions.find((v) => v.version === tmpl.version);
    if (currentVersion) {
      currentVersion.isPublished = true;
    }

    tmpl.isPublished = true;
    tmpl.updatedAt = new Date();
    this.persistState();
    this.syncSystemPromptToProjectSettings(projectId, tmpl);

    return {
      configId: templateId,
      version: tmpl.version,
      publishedAt: tmpl.updatedAt.toISOString(),
    };
  }

  rollback(projectId: string, templateId: string, targetVersion?: number): TemplateRecord {
    const tmpl = this.findById(projectId, templateId);
    const tmplVersions = this.versions.get(templateId) || [];

    if (tmplVersions.length < 2) {
      throw new BadRequestException('没有可供回滚的上一版本');
    }

    const target = targetVersion
      ? tmplVersions.find((v) => v.version === targetVersion)
      : [...tmplVersions].reverse().find((v) => v.version < tmpl.version);

    if (!target) {
      throw new BadRequestException('未找到目标回滚版本');
    }

    const now = new Date();
    tmpl.content = target.content;
    tmpl.version += 1;
    tmpl.isPublished = false;
    tmpl.updatedAt = now;

    tmplVersions.push({
      version: tmpl.version,
      content: target.content,
      createdAt: now,
      isPublished: false,
    });
    this.versions.set(templateId, tmplVersions);

    this.persistState();
    this.syncSystemPromptToProjectSettings(projectId, tmpl);
    return tmpl;
  }

  getVersions(projectId: string, templateId: string): TemplateVersion[] {
    this.findById(projectId, templateId);
    return this.versions.get(templateId) || [];
  }

  remove(projectId: string, templateId: string): void {
    this.findById(projectId, templateId);
    const index = this.templates.findIndex((t) => t.id === templateId);
    if (index !== -1) {
      this.templates.splice(index, 1);
      this.versions.delete(templateId);
      this.persistState();
    }
  }

  private persistState() {
    const payload = this.buildPersistedPayload();
    if (usePostgresPersistence()) {
      void syncPromptTemplatesToPostgres(this.prisma, payload).catch((err) =>
        console.error('[persistence] prompt-templates PG 同步失败', err)
      );
      return;
    }
    const targetDir = dirname(this.storagePath);
    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true });
    }
    writeFileSync(this.storagePath, JSON.stringify(payload, null, 2), 'utf8');
  }

  private buildPersistedPayload(): PersistedPromptTemplatesPayload {
    const payload: PersistedPromptTemplatesPayload = {
      templates: this.templates.map((t) => ({
        ...t,
        category: t.category,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
      })),
      versions: {},
    };

    for (const [tmplId, tmplVersions] of this.versions.entries()) {
      payload.versions[tmplId] = tmplVersions.map((v) => ({
        ...v,
        createdAt: v.createdAt.toISOString(),
      }));
    }

    return payload;
  }

  private restoreStateFromDisk(): RestoredPromptTemplatesState | null {
    if (!existsSync(this.storagePath)) return null;
    try {
      const raw = readFileSync(this.storagePath, 'utf8');
      const parsed = JSON.parse(raw) as PersistedTemplateState;
      return {
        templates: (parsed.templates || []).map((t) => ({
          ...t,
          category: t.category as TemplateCategory,
          createdAt: new Date(t.createdAt),
          updatedAt: new Date(t.updatedAt),
        })),
        versions: Object.fromEntries(
          Object.entries(parsed.versions || {}).map(([id, versions]) => [
            id,
            (versions || []).map((v) => ({
              ...v,
              createdAt: new Date(v.createdAt),
            })),
          ])
        ),
      };
    } catch {
      return null;
    }
  }

  private hydrateMap<T>(target: Map<string, T>, source: Record<string, T>) {
    for (const [key, value] of Object.entries(source)) {
      target.set(key, value);
    }
  }
}
