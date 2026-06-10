const PERSONA_TITLE_PATTERNS: RegExp[] = [
  /^人物小传[：:]\s*(.+)$/,
  /^角色卡[：:]\s*(.+)$/,
  /^角色卡\s*[-–—>→]+\s*(.+)$/,
  /^人设[：:]\s*(.+)$/,
  /^人物设定[：:]\s*(.+)$/,
  /^(.+?)角色卡$/,
  /^(.+?)人物卡$/,
  /^(.+?)人设$/,
  /^(.+?)人物小传$/,
  /^(.+?)人物设定$/,
];

/** 从知识库文档标题提取主角色名（用于证据锚点） */
export function extractPersonaDisplayName(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) {
    return '未命名角色';
  }
  for (const pattern of PERSONA_TITLE_PATTERNS) {
    const match = trimmed.match(pattern);
    const name = match?.[1]?.trim();
    if (name) {
      return name;
    }
  }
  return trimmed;
}

export function formatPersonaCardEvidenceBlock(input: {
  documentId: string;
  title: string;
  content: string;
  reason?: string;
}): string {
  const name = extractPersonaDisplayName(input.title);
  const lines = [
    `---------- 角色卡·${name}（仅描述该角色，勿与其他角色合并）----------`,
    `canonical_character=${name}`,
    `document_id=${input.documentId}`,
    `card_title=${input.title}`,
  ];
  if (input.reason?.trim()) {
    lines.push(`命中理由：${input.reason.trim()}`);
  }
  lines.push('', '【设定正文】', input.content.trim(), `---------- 角色卡·${name}·结束 ----------`);
  return lines.join('\n');
}

export function formatMultiPersonaEvidencePreamble(personaCount: number): string {
  if (personaCount < 2) {
    return '';
  }
  return [
    '【多角色设定须知】',
    `以下 ${personaCount} 段角色卡彼此独立。每段仅描述 canonical_character 所指角色；`,
    '其中「马甲 / 化名 / 别名 / 卧底身份」仅属于该段角色，不得张冠李戴到其他角色。',
  ].join('\n');
}

export const MULTI_PERSONA_WRITING_GUARD =
  '【写作约束】严格按各角色卡的 canonical_character 区分身份；化名、马甲、别名不得归属到其他角色。';

export const PERSONA_APPEARANCE_CONTINUITY_GUARD =
  '【外观与状态连续性】人物着装、外貌、伤势、关键持有物须与【人物当前快照】一致；仅当本章写作目标或 mustInclude 明确要求变化时方可改写，且须在正文中交代变化过程。';

export function hasMultiPersonaCardEvidence(evidenceText: string): boolean {
  const matches = evidenceText.match(/canonical_character=/g);
  return (matches?.length ?? 0) >= 2;
}

export function prependMultiPersonaPreamble(evidenceText: string, personaCount: number): string {
  const preamble = formatMultiPersonaEvidencePreamble(personaCount);
  if (!preamble || !evidenceText.trim()) {
    return evidenceText;
  }
  return `${preamble}\n\n${evidenceText}`;
}

type KnowledgeEvidenceDoc = {
  documentId: string;
  title: string;
  content: string;
  docType: string;
  reason: string;
  matchedSections: string[];
};

export function formatKnowledgeEvidenceBlock(doc: KnowledgeEvidenceDoc, index: number): string {
  if (doc.docType === 'persona_card') {
    return formatPersonaCardEvidenceBlock({
      documentId: doc.documentId,
      title: doc.title,
      content: doc.content,
      reason: doc.reason,
    });
  }
  const sections = doc.matchedSections.length > 0 ? doc.matchedSections.join(',') : 'title_match';
  return `[知识裁剪${index + 1}] document_id=${doc.documentId} title=${doc.title} sections=${sections} doc_type=${doc.docType}\n命中理由：${doc.reason}\n${doc.content.trim()}`;
}

export function assembleStructuredEvidenceText(
  fullDocuments: Array<{ docType: string }>,
  includedIndices: number[],
  trimmedBlocks: string[]
): string {
  const body = trimmedBlocks.join('\n\n');
  const personaIncludedCount = includedIndices.filter(
    (i) => fullDocuments[i]?.docType === 'persona_card'
  ).length;
  return prependMultiPersonaPreamble(body, personaIncludedCount);
}
