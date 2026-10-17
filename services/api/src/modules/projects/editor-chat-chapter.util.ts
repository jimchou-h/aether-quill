const CHINESE_DIGIT_MAP: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

const CHINESE_UNIT_MAP: Record<string, number> = {
  十: 10,
  百: 100,
  千: 1000,
};

const CHINESE_NUMERAL_PATTERN = '[零〇一二两三四五六七八九十百千]+';

/** 中文数字转阿拉伯数字；仅支持常见章号写法（一~九千九百九十九）。非法输入返回 null。 */
export function parseChineseChapterNumber(raw: string): number | null {
  if (!raw) {
    return null;
  }
  let total = 0;
  let current = 0;
  let matchedAny = false;
  for (const char of raw) {
    const digit = CHINESE_DIGIT_MAP[char];
    if (digit !== undefined) {
      current = current * 10 + digit;
      matchedAny = true;
      continue;
    }
    const unit = CHINESE_UNIT_MAP[char];
    if (unit !== undefined) {
      // 「十五」等省略前导一；current 为 0 时按 1 计
      current = (current === 0 ? 1 : current) * unit;
      total += current;
      current = 0;
      matchedAny = true;
      continue;
    }
    return null;
  }
  if (!matchedAny) {
    return null;
  }
  return total + current;
}

const CHAPTER_MENTION_PATTERN = new RegExp(
  `第\\s*(\\d+|${CHINESE_NUMERAL_PATTERN})\\s*章`,
  'g'
);

/**
 * 从问题文本识别明确的「第 N 章」锚点（阿拉伯或中文数字）。
 * 只认第一处显式提及；无锚点或章号非正返回 null，由调用方决定追问或沿用当前章。
 */
export function extractChapterNoFromQuestion(question: string): number | null {
  if (!question) {
    return null;
  }
  const pattern = new RegExp(CHAPTER_MENTION_PATTERN.source, 'g');
  const match = pattern.exec(question);
  if (!match) {
    return null;
  }
  const token = match[1];
  const chapterNo = /^\d+$/.test(token) ? Number(token) : parseChineseChapterNumber(token);
  if (!chapterNo || chapterNo <= 0 || !Number.isFinite(chapterNo)) {
    return null;
  }
  return chapterNo;
}
