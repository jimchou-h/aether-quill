/**
 * 写作工作台 prompt 拼装（与 API write-chapter.util 保持语义一致）
 */

export interface WriteChapterTaskFields {
  chapterNo: number;
  goal: string;
  pov: string;
  mustInclude?: string[];
  avoid?: string[];
  targetWords?: number;
  appearingCharacters?: string[];
}

export function assertConfirmedOutlineText(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) {
    throw new Error('生成正文前必须先确认章节大纲（confirmedOutlineText）');
  }
  return text;
}

function buildTargetWordsLine(targetWords: unknown): string {
  const parsed = Number(targetWords);
  if (Number.isFinite(parsed) && parsed > 0) {
    return `目标字数约 ${parsed} 字。`;
  }
  return '不设字数上限，在情节完整的前提下尽量充实详尽。';
}

export function buildWorkbenchDraftUserPrompt(
  task: WriteChapterTaskFields,
  confirmedOutlineText: string
): string {
  const mustInclude = Array.isArray(task.mustInclude) ? task.mustInclude : [];
  const avoid = Array.isArray(task.avoid) ? task.avoid : [];
  const sections: string[] = [
    `请撰写第${task.chapterNo}章小说正文。`,
    `写作目标：${task.goal}`,
    `叙事视角：${task.pov}`,
  ];

  if (mustInclude.length > 0) {
    sections.push(`必须包含：${mustInclude.join('；')}`);
  }
  if (avoid.length > 0) {
    sections.push(`避免内容：${avoid.join('；')}`);
  }

  sections.push(buildTargetWordsLine(task.targetWords));
  sections.push(
    `<chapter-outline>\n${confirmedOutlineText.trim()}\n</chapter-outline>`,
    '请严格按 <chapter-outline> 中的已确认大纲撰写本章正文，保持情节连贯与设定一致。'
  );

  return sections.join('\n');
}
