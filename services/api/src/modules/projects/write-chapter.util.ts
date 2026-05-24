/**
 * 写作工作台两阶段生成（AQ-217~AQ-219）
 *
 * 模板治理同步：`packages/prompt-templates/src/templates.ts`
 *  - writeChapterOutlineTemplate
 *  - writeChapterTaskTemplate
 */

export interface WriteChapterTaskInput {
  chapterNo: number;
  goal: string;
  pov: string;
  mustInclude: string[];
  avoid: string[];
  targetWords?: number;
  appearingCharacters?: string[];
  selectedEventIds?: string[];
}

export interface WriteChapterUsedRelationEvent {
  id: string;
  protagonist: string;
  counterparty: string;
  summary: string;
  evidenceSnippet?: string;
  chapterNo: number | null;
}

export const WRITE_CHAPTER_OUTLINE_TEMPLATE_KEY = 'write.chapter.outline';
export const WRITE_CHAPTER_DRAFT_TEMPLATE_KEY = 'write.chapter';

export const WRITE_CHAPTER_OUTLINE_SYSTEM_PROMPT = [
  '你是一位资深小说策划编辑，正在根据作者的写作要求为本章拟定「章节大纲」。',
  '本步骤只需要输出结构化章节大纲，不要直接输出小说正文、对白或完整段落。',
  '大纲应当覆盖：',
  '1) 本章核心冲突与情绪走向；',
  '2) 按场景或节拍列出关键事件（含起承转合）；',
  '3) 主要出场人物的目标、阻碍与状态变化；',
  '4) 与项目大纲、人物设定、关系事件的一致性提示（如有冲突须标明）。',
  '请始终参考下文 <writing-task> 中的写作要求，不得脱离作者约束凭空扩写。',
].join('\n');

export const WRITE_CHAPTER_DRAFT_SYSTEM_PROMPT = [
  '你是一位专业小说写作助手，正在根据作者已确认的章节大纲撰写本章正文。',
  '硬约束：',
  '1) 必须严格遵循 <chapter-outline> 中已确认的章节大纲结构与节拍；',
  '2) 必须满足 <writing-task> 中的写作目标、视角、必须包含与避免项；',
  '3) 保持与【叙事上下文】及【检索证据】（如有）一致，不得违背已知设定；',
  '4) 直接输出小说正文，不要输出大纲、说明、Markdown 标题或代码块包裹；',
  '5) 不得使用「（此处省略）」等占位语。',
].join('\n');

export function assertOutlineText(value: string): void {
  if (!value || !value.trim()) {
    throw new Error('章节大纲 outlineText 不能为空');
  }
}

export class WriteChapterOutlineNotConfirmedError extends Error {
  constructor(message = '生成正文前必须先确认章节大纲（confirmedOutlineText）') {
    super(message);
    this.name = 'WriteChapterOutlineNotConfirmedError';
  }
}

export function assertConfirmedOutlineForDraft(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) {
    throw new WriteChapterOutlineNotConfirmedError();
  }
  return text;
}

export function makeWriteOutlineId(): string {
  return `woutline-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildTargetWordsLine(targetWords?: number): string {
  const parsed = Number(targetWords);
  if (Number.isFinite(parsed) && parsed > 0) {
    return `【目标字数】约 ${parsed} 字`;
  }
  return '【目标字数】不设上限，在情节完整的前提下尽量充实';
}

export function buildWriteOutlineUserPrompt(input: {
  task: WriteChapterTaskInput;
  selectedRelationEvents?: WriteChapterUsedRelationEvent[];
}): string {
  const { task, selectedRelationEvents } = input;
  const sections: string[] = [];

  sections.push(`【本章写作任务】请为第 ${task.chapterNo} 章拟定章节大纲。`);
  sections.push(`【写作目标】\n${task.goal.trim()}`);
  sections.push(`【叙事视角】${task.pov.trim()}`);

  if (task.mustInclude.length > 0) {
    sections.push(`【必须包含】\n${task.mustInclude.map((item, i) => `${i + 1}. ${item}`).join('\n')}`);
  }
  if (task.avoid.length > 0) {
    sections.push(`【避免内容】\n${task.avoid.map((item, i) => `${i + 1}. ${item}`).join('\n')}`);
  }

  sections.push(buildTargetWordsLine(task.targetWords));

  if (task.appearingCharacters && task.appearingCharacters.length > 0) {
    sections.push(`【本章出场角色】${task.appearingCharacters.join('、')}`);
  }

  if (selectedRelationEvents && selectedRelationEvents.length > 0) {
    const lines = selectedRelationEvents.map((event, index) => {
      const chapterTag =
        typeof event.chapterNo === 'number' && event.chapterNo > 0
          ? `（第${event.chapterNo}章）`
          : '';
      return `${index + 1}. ${event.protagonist} ↔ ${event.counterparty}${chapterTag}：${event.summary}`;
    });
    sections.push(`【关联关系事件】\n${lines.join('\n')}`);
  }

  const taskXml = [
    '<writing-task>',
    `chapterNo: ${task.chapterNo}`,
    `goal: ${task.goal.trim()}`,
    `pov: ${task.pov.trim()}`,
    task.mustInclude.length > 0 ? `mustInclude:\n${task.mustInclude.join('\n')}` : '',
    task.avoid.length > 0 ? `avoid:\n${task.avoid.join('\n')}` : '',
    '</writing-task>',
  ]
    .filter(Boolean)
    .join('\n');

  sections.push(taskXml);
  sections.push(
    '请输出本章「章节大纲」：使用清晰的分点或分场景结构，覆盖冲突、节拍与人物弧线，不要写正文。'
  );

  return sections.join('\n\n');
}

export function buildWriteDraftUserPrompt(input: {
  task: WriteChapterTaskInput;
  confirmedOutlineText: string;
  selectedRelationEvents?: WriteChapterUsedRelationEvent[];
}): string {
  const { task, confirmedOutlineText, selectedRelationEvents } = input;
  const sections: string[] = [];

  sections.push(`【本章写作任务】请撰写第 ${task.chapterNo} 章小说正文。`);
  sections.push(`【写作目标】\n${task.goal.trim()}`);
  sections.push(`【叙事视角】${task.pov.trim()}`);

  if (task.mustInclude.length > 0) {
    sections.push(`【必须包含】\n${task.mustInclude.map((item, i) => `${i + 1}. ${item}`).join('\n')}`);
  }
  if (task.avoid.length > 0) {
    sections.push(`【避免内容】\n${task.avoid.map((item, i) => `${i + 1}. ${item}`).join('\n')}`);
  }

  sections.push(buildTargetWordsLine(task.targetWords));

  if (task.appearingCharacters && task.appearingCharacters.length > 0) {
    sections.push(`【本章出场角色】${task.appearingCharacters.join('、')}`);
  }

  if (selectedRelationEvents && selectedRelationEvents.length > 0) {
    const lines = selectedRelationEvents.map((event, index) => {
      const chapterTag =
        typeof event.chapterNo === 'number' && event.chapterNo > 0
          ? `（第${event.chapterNo}章）`
          : '';
      return `${index + 1}. ${event.protagonist} ↔ ${event.counterparty}${chapterTag}：${event.summary}`;
    });
    sections.push(`【关联关系事件】\n${lines.join('\n')}`);
  }

  sections.push(
    `<chapter-outline>\n${confirmedOutlineText.trim()}\n</chapter-outline>`
  );

  const taskXml = [
    '<writing-task>',
    `chapterNo: ${task.chapterNo}`,
    `goal: ${task.goal.trim()}`,
    `pov: ${task.pov.trim()}`,
    '</writing-task>',
  ].join('\n');

  sections.push(taskXml);
  sections.push(
    '请严格按 <chapter-outline> 中的已确认大纲撰写本章正文，保持情节连贯与设定一致。'
  );

  return sections.join('\n\n');
}
