/** 用户选择的文档类型（与 OpenAPI DocType 对齐） */
export type UserDocType = 'persona_card' | 'world_setting' | 'reference' | 'lore' | 'other';

export const DEFAULT_USER_DOC_TYPE: UserDocType = 'other';

const USER_DOC_TYPES: UserDocType[] = [
  'persona_card',
  'world_setting',
  'reference',
  'lore',
  'other',
];

/** 入库 / 向量 payload 沿用的推断类型（兼容旧数据） */
export type DocumentKnowledgeType = 'persona_card' | 'world_doc' | 'outline_doc' | 'document';

export function normalizeDocType(value: unknown): UserDocType {
  if (typeof value === 'string' && USER_DOC_TYPES.includes(value as UserDocType)) {
    return value as UserDocType;
  }
  return DEFAULT_USER_DOC_TYPE;
}

export function inferDocumentKnowledgeType(title: string, content: string): DocumentKnowledgeType {
  const t = title.trim();
  const blob = `${t}\n${content.slice(0, 400)}`;
  if (/角色卡|人物卡|人设|人物设定|人物小传/.test(blob)) {
    return 'persona_card';
  }
  if (/世界观|设定集|世界设定|地理|势力/.test(blob)) {
    return 'world_doc';
  }
  if (/大纲|卷纲|章纲|剧情线/.test(blob)) {
    return 'outline_doc';
  }
  return 'document';
}

/** 用户 docType → 入库 payload document_type */
export function docTypeForIngestion(userDocType: UserDocType, title: string, content: string): string {
  if (userDocType === 'persona_card') {
    return 'persona_card';
  }
  if (userDocType === 'world_setting') {
    return 'world_setting';
  }
  return inferDocumentKnowledgeType(title, content);
}
