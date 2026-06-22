/**
 * 项目级 systemPromptText 与任务级 override 合并为【系统指令】单段文本。
 */
export function mergeSystemPromptSections(...sections: Array<string | undefined | null>): string {
  return sections
    .map((section) => (typeof section === 'string' ? section.trim() : ''))
    .filter(Boolean)
    .join('\n\n');
}
