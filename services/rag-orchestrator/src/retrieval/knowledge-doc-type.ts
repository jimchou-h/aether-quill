const PERSONA_CARD_TITLE_HINT =
  /角色卡|人物卡|人设|人物设定|人物小传/;

export interface KnowledgeDocForTypeResolve {
  id: string;
  title: string;
  content: string;
  docType?: string;
}

/** 检索 / 标题匹配用：用户 docType 优先，否则按标题与正文前缀推断 */
export function resolveKnowledgeDocTypeForRetrieval(doc: {
  title: string;
  content?: string;
  docType?: string;
}): string {
  const raw = (doc.docType ?? 'other').trim();
  if (raw === 'persona_card') {
    return 'persona_card';
  }
  const blob = `${doc.title.trim()}\n${(doc.content ?? '').slice(0, 400)}`;
  if (PERSONA_CARD_TITLE_HINT.test(blob)) {
    return 'persona_card';
  }
  return raw || 'other';
}

export function normalizeKnowledgeDocumentsForRetrieval<T extends KnowledgeDocForTypeResolve>(
  docs: T[]
): T[] {
  return docs.map((doc) => ({
    ...doc,
    docType: resolveKnowledgeDocTypeForRetrieval(doc),
  }));
}
