export interface IdentityRelationExtractItem {
  from: string;
  to: string;
  relation: string;
  evidenceSnippet?: string;
}

export function buildChapterIdentityRelationExtractPrompt(input: {
  chapterNo: number;
  title: string;
  content: string;
  personaNames: string[];
}): string {
  const personaHint = input.personaNames.length > 0 ? input.personaNames.join('、') : '（无）';
  return [
    '你是一位小说设定编辑，请从章节正文中抽取**稳定的身份关系**（如师徒、父子、母子、恋人、夫妻、同门、主仆、仇敌、上下级等）。',
    '要求：',
    '1. 只输出 JSON 数组，不要 Markdown 或说明文字',
    '2. 每条包含 from（角色甲）、to（角色乙）、relation（甲对乙的身份称谓，表示「甲是乙的 relation」）、可选 evidenceSnippet（原文证据 1~2 句）',
    '3. 不要抽取一次性剧情事件（吵架、联手、决裂、相遇一次等），那些属于关系事件而非身份关系',
    '4. from 与 to 必须来自下列已知角色名，且 from ≠ to',
    '5. 若本章未揭示新的稳定身份关系，返回空数组 []',
    `6. 已知角色：${personaHint}`,
    '',
    `章节：第${input.chapterNo}章 ${input.title}`,
    '正文：',
    input.content,
  ].join('\n');
}

export function parseIdentityRelationsFromModelContent(
  content: string
): IdentityRelationExtractItem[] {
  const trimmed = content.trim();
  if (!trimmed) {
    return [];
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonText = fenced ? fenced[1].trim() : trimmed;

  let payload: unknown;
  try {
    payload = JSON.parse(jsonText);
  } catch {
    return [];
  }

  const items = Array.isArray(payload)
    ? payload
    : payload &&
        typeof payload === 'object' &&
        Array.isArray((payload as { relations?: unknown[] }).relations)
      ? (payload as { relations: unknown[] }).relations
      : [];

  const relations: IdentityRelationExtractItem[] = [];

  for (const item of items) {
    if (!item || typeof item !== 'object') {
      continue;
    }

    const record = item as Record<string, unknown>;
    const from = typeof record.from === 'string' ? record.from.trim() : '';
    const to = typeof record.to === 'string' ? record.to.trim() : '';
    const relation = typeof record.relation === 'string' ? record.relation.trim() : '';
    if (!from || !to || !relation || from === to) {
      continue;
    }

    const evidenceSnippet =
      typeof record.evidenceSnippet === 'string' ? record.evidenceSnippet.trim() : undefined;

    relations.push({
      from,
      to,
      relation,
      evidenceSnippet: evidenceSnippet || undefined,
    });
  }

  return relations;
}
