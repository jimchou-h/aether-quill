import { extractPersonaDisplayName } from './persona-card-evidence';
import { expandPersonaMatchTokens } from './persona-keyword-supplement';

export function scoreTitleAgainstMatchingText(matchingText: string, title: string): number {
  const m = matchingText.trim().toLowerCase();
  const t = title.trim().toLowerCase();
  if (!m || !t) {
    return 0;
  }

  let score = 0;
  const segments = m.split(/[\s\n，。、；：,.;:!?《》「」"'“”]+/).filter((s) => s.length > 0);
  for (const seg of segments) {
    if (seg.length >= 2 && t.includes(seg)) {
      score += seg.length >= 4 ? 4 : 2;
    }
  }
  const prefix = m.slice(0, Math.min(32, m.length));
  if (prefix.length >= 2 && t.includes(prefix)) {
    score += 8;
  }

  /** 匹配串含角色主名/别名时加分（优化要求长句无法分词时仍命中） */
  const displayName = extractPersonaDisplayName(title);
  const nameTokens = expandPersonaMatchTokens(displayName);
  for (const token of nameTokens) {
    const tok = token.toLowerCase();
    if (tok.length >= 2 && m.includes(tok)) {
      score += tok.length >= 4 ? 6 : 4;
    }
  }
  if (displayName.length >= 2 && m.includes(displayName.toLowerCase())) {
    score += 6;
  }

  return score;
}
