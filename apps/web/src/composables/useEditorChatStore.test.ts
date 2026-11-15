import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createEditorChatStore } from './useEditorChatStore';
import {
  editorChatSessionKey,
  type EditorChatSessionRecord,
  type EditorChatStorage,
} from '../services/editorChatStorage';

function makeFakeStorage(seed: EditorChatSessionRecord[] = []) {
  const rows = new Map(seed.map((r) => [r.key, r]));
  const calls = { load: 0, save: 0, remove: 0 };
  const storage: EditorChatStorage = {
    async load(key) {
      calls.load += 1;
      return rows.get(key) ?? null;
    },
    async save(record) {
      calls.save += 1;
      rows.set(record.key, structuredClone(record));
    },
    async remove(key) {
      calls.remove += 1;
      rows.delete(key);
    },
  };
  return { storage, rows, calls };
}

/** 一问一答的替身：每次 send 直接吐出固定回答并结束。 */
function makeFakeApi(answer = '第 7 章的节奏可以再收紧。') {
  const asks: string[] = [];
  return {
    asks,
    async streamEditorChat(
      _projectId: string,
      payload: { question: string },
      callbacks: {
        onContent?: (text: string) => void;
        onEnd?: (event: { traceId: string; chapterNo?: number }) => void;
      }
    ) {
      asks.push(payload.question);
      callbacks.onContent?.(answer);
      callbacks.onEnd?.({ traceId: 't', chapterNo: 7 });
    },
  };
}

function record(
  key: string,
  messages: EditorChatSessionRecord['messages'],
  currentChapterNo: number | null = 3
): EditorChatSessionRecord {
  return { key, messages, currentChapterNo, updatedAt: '2026-11-15T00:00:00.000Z' };
}

describe('useEditorChatStore', () => {
  it('restores the stored conversation for a userId+projectId pair on first ensure', async () => {
    const key = editorChatSessionKey('u1', 'p1');
    const { storage } = makeFakeStorage([
      record(key, [
        { role: 'user', content: '第 3 章有什么问题' },
        { role: 'assistant', content: '开场信息密度偏低。' },
      ]),
    ]);
    const store = createEditorChatStore({ api: makeFakeApi(), storage });

    await store.ensureSession({ userId: 'u1', projectId: 'p1' });
    const chat = store.current.value!.chat;
    assert.deepEqual(
      chat.messages.value.map((m) => m.content),
      ['第 3 章有什么问题', '开场信息密度偏低。']
    );
    assert.equal(chat.currentChapterNo.value, 3, '章节锚点应随会话一起恢复');

    // 同一 key 重复 ensure 不重新加载，也不重置会话
    const before = chat.messages.value;
    await store.ensureSession({ userId: 'u1', projectId: 'p1' });
    assert.equal(store.current.value!.chat.messages.value, before);
  });

  it('keeps conversations isolated per project and per user', async () => {
    const { storage, rows } = makeFakeStorage();
    const store = createEditorChatStore({ api: makeFakeApi(), storage });

    await store.ensureSession({ userId: 'u1', projectId: 'p1' });
    await store.current.value!.chat.send('项目一的追问');

    await store.ensureSession({ userId: 'u1', projectId: 'p2' });
    assert.deepEqual(store.current.value!.chat.messages.value, [], '切换项目应从空会话开始');
    await store.current.value!.chat.send('项目二的追问');

    assert.equal(rows.get(editorChatSessionKey('u1', 'p1'))?.messages.length, 2);
    assert.deepEqual(
      rows.get(editorChatSessionKey('u1', 'p2'))?.messages.map((m) => m.content),
      ['项目二的追问', '第 7 章的节奏可以再收紧。']
    );

    await store.ensureSession({ userId: 'u2', projectId: 'p1' });
    assert.deepEqual(
      store.current.value!.chat.messages.value,
      [],
      '换账号不得读到上一个账号的聊天'
    );
  });

  it('does not blank the previous project record when switching projects', async () => {
    const { storage, rows, calls } = makeFakeStorage();
    const store = createEditorChatStore({ api: makeFakeApi(), storage });

    await store.ensureSession({ userId: 'u1', projectId: 'p1' });
    await store.current.value!.chat.send('第一个问题');
    const saved = rows.get(editorChatSessionKey('u1', 'p1'));
    assert.ok(saved && saved.messages.length === 2);

    const savesBeforeSwitch = calls.save;
    await store.ensureSession({ userId: 'u1', projectId: 'p2' });

    assert.deepEqual(
      rows.get(editorChatSessionKey('u1', 'p1')),
      saved,
      '切走时的 clear 不得把空会话写回旧项目'
    );
    assert.equal(calls.save, savesBeforeSwitch, '新会话尚未产生消息前不得触发任何写入');
  });

  it('clearCurrent wipes memory and removes the stored record', async () => {
    const key = editorChatSessionKey('u1', 'p1');
    const { storage, rows } = makeFakeStorage([record(key, [{ role: 'user', content: '旧问题' }])]);
    const store = createEditorChatStore({ api: makeFakeApi(), storage });

    await store.ensureSession({ userId: 'u1', projectId: 'p1' });
    assert.ok(rows.has(key));

    store.clearCurrent();
    assert.deepEqual(store.current.value!.chat.messages.value, []);
    assert.equal(rows.has(key), false, '清空要删除持久化记录，刷新后不再回来');
  });

  it('skips load and save while userId is not ready', async () => {
    const { storage, rows, calls } = makeFakeStorage();
    const store = createEditorChatStore({ api: makeFakeApi(), storage });

    await store.ensureSession({ userId: '', projectId: 'p1' });
    assert.equal(calls.load, 0, '身份未就绪时不得读库');

    await store.current.value!.chat.send('匿名期间的提问');
    assert.equal(calls.save, 0, '身份未就绪时不得写库');
    assert.equal(rows.size, 0);

    // 身份到位后按真实 key 恢复；本地未落库所以仍是当前会话内容
    await store.ensureSession({ userId: 'u1', projectId: 'p1' });
    assert.equal(calls.load, 1);
    assert.equal(store.current.value!.key, editorChatSessionKey('u1', 'p1'));
  });
});
