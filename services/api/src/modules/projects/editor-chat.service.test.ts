import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { NotFoundException } from '@nestjs/common';

import {
  EditorChatAccessDeniedError,
  EditorChatService,
  type EditorChatGenerationGateway,
  type EditorChatProjectsPort,
} from './editor-chat.service';

function makeFakeGateway(responseText = '建议收紧第二段对话。') {
  const calls: Array<{
    prompt: string;
    systemPromptOverride: string | undefined;
    context: Record<string, unknown>;
  }> = [];
  const gateway: EditorChatGenerationGateway = {
    async streamGeneration(input) {
      calls.push({
        prompt: input.prompt,
        systemPromptOverride: input.systemPromptOverride,
        context: input.context,
      });
      // 贴近真实上游：调用期间先 start 再逐段 content
      input.callbacks.onStart?.('trace-1');
      input.callbacks.onContent?.(responseText);
      return { ok: true, text: responseText, traceId: 'trace-1', completed: true, finishReason: 'stop' };
    },
  };
  return { gateway, calls };
}

function writeEvents() {
  const events: Array<Record<string, unknown>> = [];
  return {
    events,
    ctx: {
      writeEvent: (payload: Record<string, unknown>) => {
        events.push(payload);
        return true;
      },
      isAborted: () => false,
      abortSignal: new AbortController().signal,
    },
  };
}

const projects: EditorChatProjectsPort = {
  checkAccess(projectId, userId) {
    if (projectId === 'p-forbidden') {
      throw new EditorChatAccessDeniedError();
    }
  },
  getChapter(projectId, chapterNo) {
    if (chapterNo === 99) {
      return null;
    }
    return { chapterNo, title: '初入京城', content: '他推门而入。', updatedAt: new Date() };
  },
  getPersonas(projectId) {
    return [
      {
        id: 'persona-1',
        name: '沈昭',
        profile: '谨慎多疑的年轻官员',
        state: '初入京城，未知底细',
        appearedChapterNos: [7, 8],
      },
      {
        id: 'persona-2',
        name: '路人甲',
        profile: '无关人物',
        state: '',
        appearedChapterNos: [2],
      },
    ];
  },
  resolveProjectSystemPromptText(projectId) {
    return '本项目要求文风克制。';
  },
  getRagOrchestratorUrl() {
    return 'http://orchestrator.test';
  },
};

describe('EditorChatService', () => {
  it('rejects an empty question', async () => {
    const { gateway } = makeFakeGateway();
    const service = new EditorChatService(projects, gateway);
    const { ctx, events } = writeEvents();
    await assert.rejects(
      () => service.streamChat({ projectId: 'p1', userId: 'u1', question: '   ', sse: ctx }),
      /问题不能为空/
    );
  });

  it('answers with guidance without calling the model when no chapter anchor exists', async () => {
    const fake = makeFakeGateway();
    const service = new EditorChatService(projects, fake.gateway);
    const { ctx, events } = writeEvents();
    await service.streamChat({
      projectId: 'p1',
      userId: 'u1',
      question: '有什么优化想法',
      sse: ctx,
    });
    assert.equal(fake.calls.length, 0, 'guidance path must not call the gateway');
    const content = events.filter((e) => e.event === 'content').map((e) => e.data).join('');
    assert.match(content, /请指定章节/);
    assert.ok(events.some((e) => e.event === 'end'));
  });

  it('forwards forbidden access before any model call', async () => {
    const fake = makeFakeGateway();
    const service = new EditorChatService(projects, fake.gateway);
    const { ctx } = writeEvents();
    await assert.rejects(
      () =>
        service.streamChat({
          projectId: 'p-forbidden',
          userId: 'u1',
          question: '第7章怎么改',
          sse: ctx,
        }),
      EditorChatAccessDeniedError
    );
    assert.equal(fake.calls.length, 0);
  });

  it('throws NotFound before headers when the referenced chapter is missing', async () => {
    const fake = makeFakeGateway();
    const service = new EditorChatService(projects, fake.gateway);
    const { ctx } = writeEvents();
    await assert.rejects(
      () =>
        service.streamChat({ projectId: 'p1', userId: 'u1', question: '第99章怎么改', sse: ctx }),
      NotFoundException
    );
    assert.equal(fake.calls.length, 0);
  });

  it('composes latest chapter text, matching persona cards and the effective project prompt', async () => {
    const fake = makeFakeGateway('回答正文');
    const service = new EditorChatService(projects, fake.gateway);
    const { ctx, events } = writeEvents();
    await service.streamChat({
      projectId: 'p1',
      userId: 'u1',
      question: '第七节…第 7 章有什么优化想法',
      history: [{ role: 'assistant', content: '上一轮建议' }],
      sse: ctx,
    });

    assert.equal(fake.calls.length, 1);
    const call = fake.calls[0];
    assert.ok(call.prompt.includes('他推门而入。'), 'chapter latest content must be included');
    assert.ok(call.prompt.includes('谨慎多疑的年轻官员'), 'appearing persona card must be injected');
    assert.ok(!call.prompt.includes('无关人物'), 'non-appearing persona must not leak in');
    assert.ok(call.prompt.includes('上一轮建议'), 'bounded history must be carried');
    assert.equal(call.systemPromptOverride, '本项目要求文风克制。');
    assert.match(call.prompt, /第 7 章正文/);

    const kinds = events.map((e) => e.event);
    assert.deepEqual(kinds.slice(0, 2), ['start', 'content']);
    assert.ok(kinds.includes('end'));
    const endPayload = events.find((e) => e.event === 'end');
    assert.equal(endPayload?.chapterNo, 7);
  });

  it('uses the session currentChapterNo when the question has no explicit chapter', async () => {
    const fake = makeFakeGateway();
    const service = new EditorChatService(projects, fake.gateway);
    const { ctx } = writeEvents();
    await service.streamChat({
      projectId: 'p1',
      userId: 'u1',
      question: '刚才第二条怎么改',
      currentChapterNo: 7,
      sse: ctx,
    });
    assert.equal(fake.calls.length, 1);
    assert.match(fake.calls[0].prompt, /第 7 章正文/);
  });
});
