export interface IdentityRelationMemoryInput {
  fromName: string;
  toName: string;
  relation: string;
}

export function buildIdentityRelationMemoryBlock(relations: IdentityRelationMemoryInput[]): string {
  if (relations.length === 0) {
    return '';
  }

  const lines = relations.map((item) => `- ${item.fromName} → ${item.toName}：${item.relation}`);

  return [
    '【人物身份关系】',
    ...lines,
    '',
    '【执行约束】',
    '- 上述为相对稳定的社会/亲属/门派身份，称呼与互动须一致',
    '- 不得无因改写身份关系；若剧情需要变化，须写出过渡',
  ].join('\n');
}
