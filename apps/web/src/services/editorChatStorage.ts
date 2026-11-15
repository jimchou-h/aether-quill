import { openDB, type IDBPDatabase } from 'idb';

import type { EditorChatMessage } from '../composables/useEditorChat';

export const EDITOR_CHAT_DB_NAME = 'aether-quill-editor-chat';
export const EDITOR_CHAT_STORE = 'sessions';
export const EDITOR_CHAT_DB_VERSION = 1;

/** 本地只保留最近若干条消息；章节正文与角色卡全文一律不落 IndexedDB。 */
export const EDITOR_CHAT_MAX_PERSISTED_MESSAGES = 200;

export interface EditorChatSessionRecord {
  /** `userId:projectId`：同一浏览器内按账号与项目隔离，各一段当前聊天。 */
  key: string;
  messages: EditorChatMessage[];
  currentChapterNo: number | null;
  updatedAt: string;
}

export interface EditorChatStorage {
  load(key: string): Promise<EditorChatSessionRecord | null>;
  save(record: EditorChatSessionRecord): Promise<void>;
  remove(key: string): Promise<void>;
}

export function editorChatSessionKey(userId: string, projectId: string): string {
  return `${userId}:${projectId}`;
}

export function trimEditorChatMessages(messages: EditorChatMessage[]): EditorChatMessage[] {
  return messages
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-EDITOR_CHAT_MAX_PERSISTED_MESSAGES);
}

/** 只接受形状正确的历史记录：手改过的记录宁可当空会话处理。 */
export function normalizeEditorChatRecord(
  record: unknown,
  key: string
): EditorChatSessionRecord | null {
  if (!record || typeof record !== 'object') {
    return null;
  }
  const candidate = record as Partial<EditorChatSessionRecord>;
  if (!Array.isArray(candidate.messages)) {
    return null;
  }
  const chapterNo =
    typeof candidate.currentChapterNo === 'number' &&
    Number.isFinite(candidate.currentChapterNo) &&
    candidate.currentChapterNo > 0
      ? Math.trunc(candidate.currentChapterNo)
      : null;
  return {
    key,
    messages: trimEditorChatMessages(candidate.messages as EditorChatMessage[]),
    currentChapterNo: chapterNo,
    updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : '',
  };
}

export function createEditorChatIdbStorage(): EditorChatStorage {
  let dbPromise: Promise<IDBPDatabase> | null = null;

  const openDatabase = () => {
    dbPromise ??= openDB(EDITOR_CHAT_DB_NAME, EDITOR_CHAT_DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(EDITOR_CHAT_STORE)) {
          db.createObjectStore(EDITOR_CHAT_STORE, { keyPath: 'key' });
        }
      },
    });
    return dbPromise;
  };

  return {
    async load(key) {
      try {
        return normalizeEditorChatRecord(
          await (await openDatabase()).get(EDITOR_CHAT_STORE, key),
          key
        );
      } catch {
        // 隐私模式 / 配额拒绝：降级为不持久化，聊天本身照常可用
        return null;
      }
    },
    async save(record) {
      try {
        await (
          await openDatabase()
        ).put(EDITOR_CHAT_STORE, {
          ...record,
          messages: trimEditorChatMessages(record.messages),
        });
      } catch {
        // 同上：写入失败不打断对话
      }
    },
    async remove(key) {
      try {
        await (await openDatabase()).delete(EDITOR_CHAT_STORE, key);
      } catch {
        // 删除失败时内存态已清空，本轮不再写回
      }
    },
  };
}
