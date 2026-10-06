/**
 * 事件卡存储与抽取（AQ-376）。
 * 注入开关默认关闭，避免影响现有文笔优化。
 */

import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import axios from 'axios';
import {
  assertEventCardBeat,
  isEventCardKind,
  isEventCardStatus,
  mergeEventCardsAfterExtract,
  parseExtractedEventCardCandidates,
  type EventCardKind,
  type EventCardRecord,
  type EventCardSource,
  type EventCardStatus,
} from './event-card.util';
import { resolveUpstreamFailureMessage } from './orchestrator-error.util';

export type EventCardPublic = {
  id: string;
  projectId: string;
  chapterNo: number;
  beat: string;
  entities: string[];
  kind: EventCardKind;
  status: EventCardStatus;
  evidence: string;
  source: EventCardSource;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

@Injectable()
export class EventCardsService {
  private readonly store = new Map<string, EventCardRecord[]>();

  ensureProject(projectId: string): void {
    if (!this.store.has(projectId)) {
      this.store.set(projectId, []);
    }
  }

  clearProject(projectId: string): void {
    this.store.delete(projectId);
  }

  clearAll(): void {
    this.store.clear();
  }

  hydrate(projectId: string, cards: EventCardRecord[]): void {
    this.store.set(projectId, cards);
  }

  serializeAll(): Record<string, EventCardPublic[]> {
    const out: Record<string, EventCardPublic[]> = {};
    for (const [projectId, cards] of this.store.entries()) {
      out[projectId] = cards.map((card) => this.toPublic(card));
    }
    return out;
  }

  list(projectId: string, chapterNo?: number): EventCardPublic[] {
    this.ensureProject(projectId);
    return this.store
      .get(projectId)!
      .filter((card) => !card.deletedAt)
      .filter((card) => (chapterNo ? card.chapterNo === chapterNo : true))
      .sort((a, b) => a.chapterNo - b.chapterNo || a.createdAt.getTime() - b.createdAt.getTime())
      .map((card) => this.toPublic(card));
  }

  /** 供 orchestrator 同步：含 deletedAt 过滤后的活跃卡 */
  listForContext(projectId: string): Array<{
    id: string;
    chapterNo: number;
    beat: string;
    entities: string[];
    kind: EventCardKind;
    status: EventCardStatus;
    evidence: string;
    deletedAt: null;
  }> {
    return this.list(projectId).map((card) => ({
      id: card.id,
      chapterNo: card.chapterNo,
      beat: card.beat,
      entities: card.entities,
      kind: card.kind,
      status: card.status,
      evidence: card.evidence,
      deletedAt: null,
    }));
  }

  update(
    projectId: string,
    cardId: string,
    payload: {
      beat?: string;
      entities?: string[];
      kind?: string;
      status?: string;
      evidence?: string;
    }
  ): EventCardPublic {
    this.ensureProject(projectId);
    const cards = this.store.get(projectId)!;
    const card = cards.find((item) => item.id === cardId && !item.deletedAt);
    if (!card) {
      throw new NotFoundException(`未找到事件卡: ${cardId}`);
    }
    if (payload.beat !== undefined) {
      assertEventCardBeat(payload.beat);
      card.beat = payload.beat.trim();
    }
    if (payload.entities !== undefined) {
      card.entities = payload.entities.map((n) => n.trim()).filter(Boolean).slice(0, 12);
    }
    if (payload.kind !== undefined) {
      if (!isEventCardKind(payload.kind)) {
        throw new BadRequestException('kind 非法');
      }
      card.kind = payload.kind;
    }
    if (payload.status !== undefined) {
      if (!isEventCardStatus(payload.status)) {
        throw new BadRequestException('status 非法');
      }
      card.status = payload.status;
    }
    if (payload.evidence !== undefined) {
      card.evidence = String(payload.evidence).trim().slice(0, 200);
    }
    card.source = 'user_edit';
    card.updatedAt = new Date();
    return this.toPublic(card);
  }

  softDelete(projectId: string, cardId: string): void {
    this.ensureProject(projectId);
    const cards = this.store.get(projectId)!;
    const card = cards.find((item) => item.id === cardId && !item.deletedAt);
    if (!card) {
      throw new NotFoundException(`未找到事件卡: ${cardId}`);
    }
    const now = new Date();
    card.deletedAt = now;
    card.updatedAt = now;
    card.source = card.source === 'auto' ? 'user_edit' : card.source;
  }

  async generateForChapter(input: {
    projectId: string;
    chapterNo: number;
    title: string;
    content: string;
    personaNames: string[];
    orchestratorUrl: string;
  }): Promise<EventCardPublic[]> {
    if (!input.content.trim()) {
      throw new BadRequestException('章节正文为空，无法生成事件卡');
    }

    let extracted: unknown;
    try {
      const response = await axios.post<{ cards?: unknown }>(
        `${input.orchestratorUrl}/api/extract/event-cards`,
        {
          chapterNo: input.chapterNo,
          title: input.title,
          content: input.content,
          personaNames: input.personaNames,
        },
        { timeout: 120000 }
      );
      extracted = response.data?.cards ?? response.data;
    } catch (error) {
      const message = await resolveUpstreamFailureMessage(error, '调用事件卡抽取服务失败');
      throw new BadGatewayException(message);
    }

    const candidates = parseExtractedEventCardCandidates(extracted);
    this.ensureProject(input.projectId);
    const existing = this.store.get(input.projectId)!;
    const merged = mergeEventCardsAfterExtract({
      existing,
      projectId: input.projectId,
      chapterNo: input.chapterNo,
      candidates,
    });
    this.store.set(input.projectId, merged);
    return this.list(input.projectId, input.chapterNo);
  }

  private toPublic(card: EventCardRecord): EventCardPublic {
    return {
      id: card.id,
      projectId: card.projectId,
      chapterNo: card.chapterNo,
      beat: card.beat,
      entities: [...card.entities],
      kind: card.kind,
      status: card.status,
      evidence: card.evidence,
      source: card.source,
      createdAt: card.createdAt.toISOString(),
      updatedAt: card.updatedAt.toISOString(),
      deletedAt: card.deletedAt ? card.deletedAt.toISOString() : null,
    };
  }
}
