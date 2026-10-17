import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { useEditorChat } from './useEditorChat';
import type { EditorChatEndEvent, EditorChatHistoryMessage } from '../services/api';

type FakeCall = {
  projectId: string;
  question: string;
  history?: EditorChatHistoryMessage[];
  currentChapterNo?: number;
};

function makeFakeApi(
  behavior: (
    call: FakeCall,
    emit: {
      content: (piece: string) => void;
      end: (event: EditorChatEndEvent) => void;
      error: (message: string) => void;
    }
  ) => void
) {
  const calls: FakeCall[] = [];
  return {
    calls,
    async streamEditorChat(
      projectId: string,
      payload: Omit<FakeCall, 'projectId'>,
      callbacks: {
        onContent?: (text: string) => void;
        onEnd?: (event: EditorChatEndEvent) => void;
        onError?: (message: string) => void;
      }
    ) {
      const call = { projectId, ...payload };
      calls.push(call);
      behavior(call, {
        content: (piece) => callbacks.onContent?.(piece),
        end: (event) => callbacks.onEnd?.(event),
        error: (message) => callbacks.onError?.(message),
      });
    },
  };
}

describe('useEditorChat', () => {
  it('appends the question and accumulates streamed content into one assistant message', async () => {
    const api = makeFakeApi((_call, emit) => {
      emit.content('第一段建议。');
      emit.content('第二段建议。');
      emit.end({ traceId: 't1', chapterNo: 7, completed: true, guidance: false });
    });
    const chat = useEditorChat({ projectId: 'p1', api });

    const ok = await chat.send('第7章有什么优化想法');
    assert.equal(ok, true);
    assert.deepEqual(
      chat.messages.value.map((m) => [m.role, m.content]),
      [
        ['user', '第7章有什么优化想法'],
        ['assistant', '第一段建议。第二段建议。'],
      ]
    );
    assert.equal(chat.streaming.value, false);
    assert.equal(chat.currentChapterNo.value, 7);
  });

  it('rejects an empty question without calling the api', async () => {
    const api = makeFakeApi(() => undefined);
    const chat = useEditorChat({ projectId: 'p1', api });
    const ok = await chat.send('   ');
    assert.equal(ok, false);
    assert.equal(api.calls.length, 0);
  });

  it('trims the question and sends bounded recent history plus current chapter anchor', async () => {
    const api = makeFakeApi((_call, emit) =>
      emit.end({ traceId: 't1', chapterNo: 7, completed: true, guidance: false })
    );
    const chat = useEditorChat({ projectId: 'p1', api });
    await chat.send('第一条建议很好，第二条怎么改');
    await chat.send(' 继续说说 ');

    const second = api.calls[1];
    assert.equal(second.question, '继续说说');
    assert.equal(second.currentChapterNo, 7);
    assert.deepEqual(second.history, [
      { role: 'user', content: '第一条建议很好，第二条怎么改' },
      { role: 'assistant', content: '' },
    ]);
  });

  it('surfaces stream errors as a visible assistant error message and keeps history usable', async () => {
    const api = makeFakeApi((_call, emit) => {
      emit.content('半');
      emit.error('生成服务不可用');
    });
    const chat = useEditorChat({ projectId: 'p1', api });
    const ok = await chat.send('第7章怎么改');
    assert.equal(ok, false);
    assert.equal(chat.error.value, '生成服务不可用');
    assert.equal(chat.streaming.value, false);
    const last = chat.messages.value[chat.messages.value.length - 1];
    assert.equal(last.role, 'assistant');
    assert.equal(last.content, '半');
  });

  it('ignores a second concurrent send while streaming', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const api = {
      calls: 0,
      async streamEditorChat(
        _projectId: string,
        _payload: unknown,
        callbacks: { onEnd?: (event: EditorChatEndEvent) => void }
      ) {
        api.calls += 1;
        await gate;
        callbacks.onEnd?.({ traceId: '', completed: true, guidance: false });
      },
    };
    const chat = useEditorChat({ projectId: 'p1', api });
    const first = chat.send('第一个问题');
    const second = await chat.send('并发问题');
    assert.equal(second, false, 'second send must be rejected while streaming');
    release?.();
    await first;
    assert.equal(api.calls, 1);
  });
});
