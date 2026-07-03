import type { PreviewRetrievalItem, PreviewRetrievalResult } from '../services/api';

function extractPersonaNameFromPreviewItem(item: PreviewRetrievalItem): string | null {
  if (item.pool !== 'persona_card') {
    return null;
  }
  const canonical =
    typeof item.meta?.canonicalCharacter === 'string' ? item.meta.canonicalCharacter.trim() : '';
  if (canonical) {
    return canonical;
  }
  const title = item.title.trim();
  const colonMatch = title.match(/[：:](.+)$/);
  if (colonMatch?.[1]) {
    return colonMatch[1].trim();
  }
  if (title.endsWith('人物小传')) {
    return title.replace(/人物小传$/, '').trim();
  }
  if (title.endsWith('角色卡')) {
    return title.replace(/角色卡$/, '').trim();
  }
  const arrowParts = title.split('->');
  if (arrowParts.length > 1) {
    return arrowParts[arrowParts.length - 1]?.trim() || null;
  }
  return title || null;
}

/** 从检索预览勾选结果解析创作精修使用的角色名（仅 persona_card 池） */
export function resolvePersonaNamesFromPreviewSelection(
  result: PreviewRetrievalResult,
  selectedIds: string[]
): string[] {
  const selected = new Set(selectedIds);
  const names = new Set<string>();
  for (const item of result.items) {
    if (!selected.has(item.id)) {
      continue;
    }
    const name = extractPersonaNameFromPreviewItem(item);
    if (name) {
      names.add(name);
    }
  }
  return [...names];
}

export function hasSelectedPersonaCard(
  result: PreviewRetrievalResult,
  selectedIds: string[]
): boolean {
  const selected = new Set(selectedIds);
  return result.items.some((item) => item.pool === 'persona_card' && selected.has(item.id));
}
