export function buildFallbackPersonaState(chapterNo: number, chapterContent: string) {
  const firstSentence = chapterContent
    .replace(/\s+/g, ' ')
    .split(/[。！？\n]/u)
    .map((item) => item.trim())
    .find(Boolean);

  if (!firstSentence) {
    return `第${chapterNo}章已更新，状态待补充`;
  }

  return `第${chapterNo}章后：${firstSentence.slice(0, 48)}`;
}

export function trimForPrompt(content: string, maxLength: number) {
  if (content.length <= maxLength) {
    return content;
  }

  return `${content.slice(0, maxLength)}\n...(已截断)`;
}

export function normalizePersonaStateOutput(raw: string) {
  const normalized = raw
    .trim()
    .replace(/^人物状态[:：]\s*/u, '')
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean);

  return normalized || null;
}
