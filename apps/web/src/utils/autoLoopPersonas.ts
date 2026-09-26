export function suggestAutoLoopPersonaNames(
  personas: Array<{ name: string; status?: string }>,
  chapterContent: string
): string[] {
  const content = chapterContent ?? '';
  const names: string[] = [];
  const seen = new Set<string>();
  for (const persona of personas) {
    const name = persona.name?.trim() ?? '';
    if (!name || seen.has(name) || !content.includes(name)) {
      continue;
    }
    seen.add(name);
    names.push(name);
  }
  return names;
}

export function toggleAutoLoopPersonaName(selected: string[], name: string): string[] {
  const trimmed = name.trim();
  if (!trimmed) {
    return selected;
  }
  if (selected.includes(trimmed)) {
    return selected.filter((item) => item !== trimmed);
  }
  return [...selected, trimmed];
}
