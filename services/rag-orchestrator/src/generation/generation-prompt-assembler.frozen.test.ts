import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildUserMessage } from './generation-prompt-assembler';

describe('F4 精修冻结参考材料：最终消息不随当前设置漂移', () => {
  it('有冻结材料时用冻结块组装，完全忽略当前 narrative / evidence / style', () => {
    const message = buildUserMessage(
      {
        systemPromptText: '项目 system',
        narrativeContext: '【当前人物】甲（运行中改动过）',
        retrievedEvidence: '当前检索证据（运行中改动过）',
        styleSampleBlock: '【文风参照】\n当前样本（运行中改动过）',
        frozenReferenceMaterials: {
          personaText: '【人物设定】\n甲：冻结版角色卡',
          knowledgeText: '冻结知识：钥匙在桌上',
          styleSampleBlock: '【文风参照】\n冻结样本',
        },
      },
      '<chapter-original>冻结原文</chapter-original>'
    );

    assert.match(message, /【参考上下文】\n【人物设定】\n甲：冻结版角色卡/);
    assert.match(message, /【检索证据】\n冻结知识：钥匙在桌上/);
    assert.match(message, /【文风参照】\n冻结样本/);
    assert.match(message, /【任务输入】\n<chapter-original>冻结原文<\/chapter-original>/);

    // 当前 projectCtx 的叙事 / 检索 / 文风不得出现
    assert.doesNotMatch(message, /当前人物/);
    assert.doesNotMatch(message, /当前检索证据/);
    assert.doesNotMatch(message, /当前样本/);
  });

  it('冻结材料为空字符串时不注入对应分块，保持确定性', () => {
    const message = buildUserMessage(
      {
        systemPromptText: '项目 system',
        narrativeContext: '当前人物（应被忽略）',
        retrievedEvidence: '当前证据（应被忽略）',
        frozenReferenceMaterials: { personaText: '', knowledgeText: '', styleSampleBlock: '' },
      },
      '正文'
    );
    assert.doesNotMatch(message, /【参考上下文】/);
    assert.doesNotMatch(message, /【检索证据】/);
    assert.match(message, /【任务输入】\n正文/);
    assert.doesNotMatch(message, /当前人物/);
    assert.doesNotMatch(message, /当前证据/);
  });

  it('无冻结材料时保持原有行为：使用当前 narrative / evidence / style', () => {
    const message = buildUserMessage(
      {
        systemPromptText: '项目 system',
        narrativeContext: '【人物当前快照】甲',
        retrievedEvidence: '当前检索证据',
        styleSampleBlock: '【文风参照】\n当前样本',
      },
      '正文'
    );
    assert.match(message, /【参考上下文】/);
    assert.match(message, /当前检索证据/);
    assert.match(message, /当前样本/);
  });
});
