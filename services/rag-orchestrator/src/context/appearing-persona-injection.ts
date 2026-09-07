import type { PersonaContextPayload } from './persona-snapshot';
import { resolvePersonaSnapshotAsOfChapter } from './persona-snapshot';
import { applyHeadCharBudget } from './narrative-budget';

export type KnowledgeDocForPersonaInject = {
  id: string;
  title: string;
  content: string;
  docType?: string;
  personaId?: string | null;
};

export type AppearingPersonaInjectionInput = {
  appearingNames: string[];
  personas: PersonaContextPayload[];
  knowledgeDocuments: KnowledgeDocForPersonaInject[];
  currentChapterNo?: number;
  /** 每张静态卡最大字符 */
  staticCardMaxChars?: number;
};

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '');
}

function findPersonaByName(
  personas: PersonaContextPayload[],
  name: string
): PersonaContextPayload | undefined {
  const key = normalizeName(name);
  return personas.find((p) => normalizeName(p.name) === key);
}

function findLinkedCard(
  docs: KnowledgeDocForPersonaInject[],
  persona: PersonaContextPayload | undefined,
  appearingName: string
): KnowledgeDocForPersonaInject | undefined {
  if (persona?.id) {
    const linked = docs.find(
      (d) => (d.docType || '') === 'persona_card' && d.personaId === persona.id
    );
    if (linked) {
      return linked;
    }
  }
  const nameKey = normalizeName(appearingName);
  return docs.find((d) => {
    if ((d.docType || '') !== 'persona_card') {
      return false;
    }
    const title = normalizeName(d.title);
    return title.includes(nameKey) || nameKey.includes(title.replace(/^.*[：:·]/, ''));
  });
}

/**
 * 出场人物：每人「静态卡（裁剪）+ 动态快照」合并块，替代单 active persona 全文。
 */
export function buildAppearingPersonaInjection(
  input: AppearingPersonaInjectionInput
): { text: string; injectedNames: string[] } {
  const maxChars = input.staticCardMaxChars ?? 1200;
  const names = [...new Set(input.appearingNames.map((n) => n.trim()).filter(Boolean))];
  if (names.length === 0) {
    return { text: '', injectedNames: [] };
  }

  const blocks: string[] = [];
  const injectedNames: string[] = [];

  for (const name of names) {
    const persona = findPersonaByName(input.personas, name);
    const card = findLinkedCard(input.knowledgeDocuments, persona, name);

    const snapshot =
      persona && input.currentChapterNo
        ? resolvePersonaSnapshotAsOfChapter(persona.chapterStates ?? [], input.currentChapterNo)
        : null;

    const parts: string[] = [`---------- 出场角色·${name} ----------`];
    if (card?.content?.trim() && maxChars > 0) {
      parts.push('【静态设定卡】');
      parts.push(applyHeadCharBudget(card.content, maxChars));
    } else if (persona?.profile?.trim() && maxChars > 0) {
      parts.push('【人物简介】');
      parts.push(applyHeadCharBudget(persona.profile, Math.min(400, maxChars)));
    }
    if (snapshot?.summaryLine || snapshot?.snapshot) {
      parts.push('【动态快照】');
      if (snapshot.summaryLine) {
        parts.push(snapshot.summaryLine);
      } else if (snapshot.snapshot) {
        const s = snapshot.snapshot;
        parts.push(
          [
            s.clothing ? `着装：${s.clothing}` : '',
            s.appearance ? `外貌：${s.appearance}` : '',
            s.status ? `状态：${s.status}` : '',
          ]
            .filter(Boolean)
            .join('；') || '（有快照记录）'
        );
      }
    } else if (persona?.state?.trim()) {
      parts.push(`【当前状态】\n${applyHeadCharBudget(persona.state, 300)}`);
    }
    parts.push(`---------- 出场角色·${name}·结束 ----------`);
    if (parts.length > 2) {
      blocks.push(parts.join('\n'));
      injectedNames.push(name);
    }
  }

  if (blocks.length === 0) {
    return { text: '', injectedNames: [] };
  }

  return {
    text: `【出场人物设定】（静态卡裁剪 + 动态快照；勿与其他角色合并）\n\n${blocks.join('\n\n')}`,
    injectedNames,
  };
}
