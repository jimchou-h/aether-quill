/**
 * 角色卡标题 ↔ 人物名 预匹配（AQ-364）
 * 不搬内容，只产出建议关联。
 */

export interface PersonaLinkCandidate {
  id: string;
  name: string;
}

export type PersonaCardLinkDecision =
  | { status: 'linked'; personaId: string; score: number }
  | { status: 'ambiguous'; candidates: Array<{ personaId: string; name: string; score: number }> }
  | { status: 'orphan' };

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '');
}

/** 从角色卡标题提取主名（与 orchestrator extractPersonaDisplayName 对齐的轻量版） */
export function extractCardDisplayName(title: string): string {
  const trimmed = title.trim();
  const patterns = [
    /^人物小传[：:]\s*(.+)$/,
    /^角色卡[：:]\s*(.+)$/,
    /^角色卡\s*[-–—>·→]+\s*(.+)$/,
    /^(.+?)角色卡$/,
    /^(.+?)人物小传$/,
  ];
  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    const name = match?.[1]?.trim();
    if (name) return name;
  }
  return trimmed;
}

export function scorePersonaNameMatch(cardTitle: string, personaName: string): number {
  const display = normalizeName(extractCardDisplayName(cardTitle));
  const name = normalizeName(personaName);
  if (!display || !name) return 0;
  if (display === name) return 100;
  if (display.includes(name) || name.includes(display)) return 80;
  return 0;
}

export function decidePersonaCardLink(
  cardTitle: string,
  personas: PersonaLinkCandidate[],
  minScore = 80
): PersonaCardLinkDecision {
  const scored = personas
    .map((p) => ({ personaId: p.id, name: p.name, score: scorePersonaNameMatch(cardTitle, p.name) }))
    .filter((row) => row.score >= minScore)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  if (scored.length === 0) {
    return { status: 'orphan' };
  }
  if (scored.length === 1 || scored[0]!.score > scored[1]!.score) {
    return { status: 'linked', personaId: scored[0]!.personaId, score: scored[0]!.score };
  }
  return { status: 'ambiguous', candidates: scored.slice(0, 5) };
}
