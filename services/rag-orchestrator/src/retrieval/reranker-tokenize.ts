function isCjkChar(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return (code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3400 && code <= 0x4dbf);
}

/**
 * 重排用词法 token：CJK 连续段取相邻 bigram（单字段取单字），拉丁/数字按词。
 * 避免中文无空格时被标点切成整句导致 `includes` 无法命中。
 */
export function tokenizeForRerank(text: string): string[] {
  const lower = text.toLowerCase().trim();
  if (!lower) {
    return [];
  }

  const tokens: string[] = [];
  const seen = new Set<string>();

  const add = (token: string) => {
    const value = token.trim();
    if (value.length === 0 || seen.has(value)) {
      return;
    }
    seen.add(value);
    tokens.push(value);
  };

  let i = 0;
  while (i < lower.length) {
    const ch = lower[i];
    if (isCjkChar(ch)) {
      let j = i;
      while (j < lower.length && isCjkChar(lower[j])) {
        j += 1;
      }
      const run = lower.slice(i, j);
      if (run.length === 1) {
        add(run);
      } else {
        for (let k = 0; k < run.length - 1; k += 1) {
          add(run.slice(k, k + 2));
        }
      }
      i = j;
    } else if (/[a-z0-9]/.test(ch)) {
      let j = i;
      while (j < lower.length && /[a-z0-9]/.test(lower[j])) {
        j += 1;
      }
      add(lower.slice(i, j));
      i = j;
    } else {
      i += 1;
    }
  }

  return tokens;
}
