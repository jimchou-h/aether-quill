export type DocumentKnowledgeType = 'persona_card' | 'world_doc' | 'outline_doc' | 'document';

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
