import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { ProjectsService } from '../projects/projects.service';
import {
  getTaskPromptDefinition,
  getWarehouseDefaultTaskPromptText,
  isAllowedTaskPromptKey,
  TASK_PROMPT_DEFINITIONS,
} from './task-prompt-defaults';
import type {
  ProjectTaskPromptRecord,
  TaskPromptDetail,
  TaskPromptListItem,
  TaskPromptPublishResult,
  TaskPromptRollbackResult,
  TaskPromptVersionSnapshot,
} from './task-prompts.entity';

interface PersistedTaskPromptsPayload {
  records: ProjectTaskPromptRecord[];
  versions: Record<string, TaskPromptVersionSnapshot[]>;
}

@Injectable()
export class TaskPromptsService {
  private readonly storagePath = join(resolve(process.cwd()), 'data', 'task-prompts.json');
  private readonly records = new Map<string, ProjectTaskPromptRecord>();
  private readonly versions = new Map<string, TaskPromptVersionSnapshot[]>();

  constructor(
    @Inject(forwardRef(() => ProjectsService))
    private readonly projectsService: ProjectsService
  ) {
    const restored = this.restoreStateFromDisk();
    if (restored) {
      this.applyRestored(restored);
    }
  }

  private recordKey(projectId: string, templateKey: string): string {
    return `${projectId}:${templateKey}`;
  }

  private applyRestored(payload: PersistedTaskPromptsPayload) {
    this.records.clear();
    this.versions.clear();
    for (const record of payload.records) {
      this.records.set(this.recordKey(record.projectId, record.templateKey), record);
    }
    for (const [key, rows] of Object.entries(payload.versions)) {
      this.versions.set(key, rows);
    }
  }

  private restoreStateFromDisk(): PersistedTaskPromptsPayload | null {
    if (!existsSync(this.storagePath)) {
      return null;
    }
    try {
      const raw = readFileSync(this.storagePath, 'utf8');
      const parsed = JSON.parse(raw) as PersistedTaskPromptsPayload;
      if (!parsed || !Array.isArray(parsed.records)) {
        return null;
      }
      return {
        records: parsed.records,
        versions: parsed.versions ?? {},
      };
    } catch {
      return null;
    }
  }

  private persistState() {
    const payload: PersistedTaskPromptsPayload = {
      records: [...this.records.values()],
      versions: Object.fromEntries(this.versions.entries()),
    };
    const targetDir = dirname(this.storagePath);
    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true });
    }
    writeFileSync(this.storagePath, JSON.stringify(payload, null, 2), 'utf8');
  }

  private assertAllowedKey(templateKey: string) {
    if (!isAllowedTaskPromptKey(templateKey)) {
      throw new BadRequestException(`不支持的 templateKey: ${templateKey}`);
    }
  }

  private getOrInitRecord(projectId: string, templateKey: string): ProjectTaskPromptRecord {
    const key = this.recordKey(projectId, templateKey);
    const existing = this.records.get(key);
    if (existing) {
      return existing;
    }
    const def = getTaskPromptDefinition(templateKey);
    const now = new Date().toISOString();
    const record: ProjectTaskPromptRecord = {
      projectId,
      templateKey,
      draftText: def.defaultText,
      publishedText: '',
      version: 0,
      updatedAt: now,
    };
    this.records.set(key, record);
    return record;
  }

  private toListItem(record: ProjectTaskPromptRecord | null, def: {
    templateKey: string;
    name: string;
    defaultText: string;
  }): TaskPromptListItem {
    const draftText = record?.draftText?.trim() ? record.draftText : def.defaultText;
    const publishedText = record?.publishedText?.trim()
      ? record.publishedText
      : def.defaultText;
    return {
      templateKey: def.templateKey,
      name: def.name,
      defaultText: def.defaultText,
      draftText,
      publishedText,
      version: record?.version ?? 0,
      hasCustomDraft: Boolean(record && record.draftText.trim() !== def.defaultText),
      hasCustomPublished: Boolean(
        record && record.publishedText.trim() && record.publishedText.trim() !== def.defaultText
      ),
      updatedAt: record?.updatedAt,
    };
  }

  listByProject(projectId: string): TaskPromptListItem[] {
    this.projectsService.findOne(projectId);
    return TASK_PROMPT_DEFINITIONS.map((def) => {
      const record = this.records.get(this.recordKey(projectId, def.templateKey)) ?? null;
      return this.toListItem(record, def);
    });
  }

  getDetail(projectId: string, templateKey: string): TaskPromptDetail {
    this.projectsService.findOne(projectId);
    this.assertAllowedKey(templateKey);
    const def = getTaskPromptDefinition(templateKey);
    const record = this.records.get(this.recordKey(projectId, templateKey)) ?? null;
    return this.toListItem(record, def);
  }

  saveDraft(projectId: string, templateKey: string, draftText: string): TaskPromptDetail {
    this.projectsService.findOne(projectId);
    this.assertAllowedKey(templateKey);
    const text = typeof draftText === 'string' ? draftText.trim() : '';
    if (!text) {
      throw new BadRequestException('draftText 不能为空');
    }

    const record = this.getOrInitRecord(projectId, templateKey);
    const now = new Date().toISOString();
    record.draftText = text;
    record.version += 1;
    record.updatedAt = now;

    const versionKey = this.recordKey(projectId, templateKey);
    const history = this.versions.get(versionKey) ?? [];
    history.push({
      version: record.version,
      draftText: record.draftText,
      publishedText: record.publishedText,
      createdAt: now,
    });
    this.versions.set(versionKey, history);
    this.records.set(versionKey, record);
    this.persistState();

    return this.getDetail(projectId, templateKey);
  }

  publish(projectId: string, templateKey: string): TaskPromptPublishResult {
    this.projectsService.findOne(projectId);
    this.assertAllowedKey(templateKey);
    const record = this.getOrInitRecord(projectId, templateKey);
    const draft = record.draftText.trim();
    if (!draft) {
      throw new BadRequestException('没有可发布的草稿');
    }

    const now = new Date();
    record.publishedText = draft;
    record.version += 1;
    record.updatedAt = now.toISOString();
    this.records.set(this.recordKey(projectId, templateKey), record);
    this.persistState();

    return {
      templateKey,
      version: record.version,
      publishedAt: record.updatedAt,
    };
  }

  rollback(
    projectId: string,
    templateKey: string,
    targetVersion?: number
  ): TaskPromptRollbackResult {
    this.projectsService.findOne(projectId);
    this.assertAllowedKey(templateKey);
    const versionKey = this.recordKey(projectId, templateKey);
    const history = this.versions.get(versionKey) ?? [];
    if (history.length < 2) {
      throw new BadRequestException('没有可供回滚的上一版本');
    }

    const record = this.getOrInitRecord(projectId, templateKey);
    const target = targetVersion
      ? history.find((row) => row.version === targetVersion)
      : [...history].reverse().find((row) => row.version < record.version);

    if (!target) {
      throw new BadRequestException('未找到目标回滚版本');
    }

    const now = new Date();
    record.draftText = target.draftText;
    record.publishedText = target.publishedText;
    record.version += 1;
    record.updatedAt = now.toISOString();

    history.push({
      version: record.version,
      draftText: record.draftText,
      publishedText: record.publishedText,
      createdAt: record.updatedAt,
    });
    this.versions.set(versionKey, history);
    this.records.set(versionKey, record);
    this.persistState();

    return {
      templateKey,
      version: record.version,
      rolledBackAt: record.updatedAt,
    };
  }

  /** 运行时生效：项目已发布文本，否则仓库默认 */
  resolveTaskSystemPrompt(projectId: string, templateKey: string): string {
    this.assertAllowedKey(templateKey);
    const record = this.records.get(this.recordKey(projectId, templateKey));
    const published = record?.publishedText?.trim();
    if (published) {
      return published;
    }
    return getWarehouseDefaultTaskPromptText(templateKey);
  }

  /** 运行时生效 Prompt 的内容指纹（用于 Final Polish 幂等） */
  getTaskPromptFingerprint(projectId: string, templateKey: string): string {
    const text = this.resolveTaskSystemPrompt(projectId, templateKey);
    return createHash('sha256').update(text).digest('hex').slice(0, 16);
  }

  getPublishedTaskPromptsMap(projectId: string): Record<string, string> {
    this.projectsService.findOne(projectId);
    const map: Record<string, string> = {};
    for (const def of TASK_PROMPT_DEFINITIONS) {
      const record = this.records.get(this.recordKey(projectId, def.templateKey));
      const published = record?.publishedText?.trim();
      if (published) {
        map[def.templateKey] = published;
      }
    }
    return map;
  }

  /** 任意白名单 key 的已发布或默认全文（供同步兜底） */
  getEffectivePublishedTaskPromptsMap(projectId: string): Record<string, string> {
    this.projectsService.findOne(projectId);
    const map: Record<string, string> = {};
    for (const def of TASK_PROMPT_DEFINITIONS) {
      map[def.templateKey] = this.resolveTaskSystemPrompt(projectId, def.templateKey);
    }
    return map;
  }
}
