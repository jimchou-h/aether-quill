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
  return score;
}
