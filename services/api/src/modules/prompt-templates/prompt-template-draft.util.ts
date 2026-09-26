/** 提示词比较与运行时取稿：避免无改动保存把已发布打成草稿。 */

export const WAREHOUSE_DEFAULT_SYSTEM_PROMPT =
  '你是一位专业的小说写作助手。请帮助用户进行小说创作，保持逻辑连贯和设定一致性。';

export function normalizePromptTemplateText(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

export function isBlankPromptText(text: string | undefined | null): boolean {
  return !String(text ?? '').trim();
}

/** 多个 isPublished 并存时取最后一份非空已发布稿，避免早期 39 字默认盖住长稿。 */
export function pickLatestPublishedContent(
  versions: Array<{ content: string; isPublished: boolean }> | undefined
): string {
  if (!versions?.length) {
    return '';
  }
  for (let i = versions.length - 1; i >= 0; i -= 1) {
    if (!versions[i]?.isPublished) {
      continue;
    }
    const text = versions[i].content?.trim();
    if (text) {
      return text;
    }
  }
  return '';
}

export function pickSystemTemplate<
  T extends { category: string; isPublished: boolean; content: string },
>(templates: T[]): T | undefined {
  const systems = templates.filter((row) => row.category === 'system');
  return (
    systems.find((row) => row.isPublished && row.content.trim()) ||
    systems.find((row) => row.content.trim()) ||
    systems[0]
  );
}

export function promptTemplateUpdateChanged(input: {
  currentContent: string;
  currentName: string;
  nextContent?: string;
  nextName?: string;
}): boolean {
  if (input.nextContent !== undefined) {
    const current = normalizePromptTemplateText(input.currentContent);
    const next = normalizePromptTemplateText(input.nextContent);
    if (next !== current) {
      return true;
    }
  }
  if (input.nextName !== undefined) {
    const nextName = input.nextName.trim() || input.currentName;
    if (nextName !== input.currentName) {
      return true;
    }
  }
  return false;
}

/** 运行时用已发布正文；未发布过才回退当前稿 / settings。 */
export function resolveEffectiveSystemPromptContent(
  template: { content: string; isPublished: boolean } | undefined,
  versions: Array<{ content: string; isPublished: boolean }> | undefined,
  settingsFallback: string
): string {
  const fallback = settingsFallback.trim();
  if (!template) {
    return fallback;
  }
  if (template.isPublished && template.content.trim()) {
    return template.content.trim();
  }
  const published = pickLatestPublishedContent(versions);
  if (published) {
    return published;
  }
  return template.content.trim() || fallback;
}
