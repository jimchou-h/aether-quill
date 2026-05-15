export type DocType = 'persona_card' | 'world_doc' | 'outline_doc' | 'document';

export interface ParsedDocSection {
  section: string;
  sectionTitle: string;
  content: string;
}

const SECTION_ALIASES: Record<string, string> = {
  身份: 'identity',
  基本信息: 'identity',
  背景: 'background',
  经历: 'background',
  能力: 'ability',
  技能: 'ability',
  关系: 'relationship',
  人物关系: 'relationship',
  性格: 'personality',
  外貌: 'appearance',
  目标: 'motivation',
  动机: 'motivation',
};

const BRACKET_HEADER = /^【\s*(.+?)\s*】\s*[:：]?\s*$/;
const MARKDOWN_HEADER = /^#{1,3}\s*(.+?)\s*$/;
const PLAIN_HEADER = /^(.{2,16})[:：]\s*$/;

function matchSectionHeader(line: string): string | null {
  const bracket = line.match(BRACKET_HEADER);
  if (bracket?.[1]) {
    return bracket[1].trim();
  }
  const md = line.match(MARKDOWN_HEADER);
  if (md?.[1]) {
    return md[1].trim();
  }
  const plain = line.match(PLAIN_HEADER);
  if (plain?.[1]) {
    return plain[1].trim();
  }
  return null;
}

export function inferDocType(title: string, content: string): DocType {
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

function normalizeSectionKey(raw: string): string {
  const trimmed = raw.trim().replace(/[#【】\s]/g, '');
  for (const [cn, en] of Object.entries(SECTION_ALIASES)) {
    if (trimmed.includes(cn)) {
      return en;
    }
  }
  const slug = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, '_')
    .replace(/^_+|_+$/g, '');
  return slug || 'general';
}

/**
 * 将正文按常见角色卡/设定标题切分为 section；无法识别时整篇为 general。
 */
export function parseDocumentSections(content: string): ParsedDocSection[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const sections: ParsedDocSection[] = [];
  let currentTitle = '正文';
  let currentKey = 'general';
  let buffer: string[] = [];

  const flush = () => {
    const text = buffer.join('\n').trim();
    if (text) {
      sections.push({
        section: currentKey,
        sectionTitle: currentTitle,
        content: text,
      });
    }
    buffer = [];
  };

  for (const line of lines) {
    const title = matchSectionHeader(line.trim());
    if (title && title.length >= 2 && title.length <= 16) {
      flush();
      currentTitle = title;
      currentKey = normalizeSectionKey(currentTitle);
      continue;
    }
    buffer.push(line);
  }
  flush();

  if (sections.length === 0 && content.trim()) {
    return [
      {
        section: 'general',
        sectionTitle: '正文',
        content: content.trim(),
      },
    ];
  }
  return sections;
}

/**
 * persona_card 按 section 切段；其它类型保持段落级切分前的整段列表（单 section）。
 */
export function sectionsForIngestion(
  title: string,
  content: string,
  docType: DocType
): ParsedDocSection[] {
  if (docType === 'persona_card') {
    const parsed = parseDocumentSections(content);
    if (parsed.length > 1) {
      return parsed;
    }
  }
  return [
    {
      section: 'general',
      sectionTitle: title.trim() || '正文',
      content: content.trim(),
    },
  ];
}
