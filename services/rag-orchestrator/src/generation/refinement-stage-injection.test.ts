/**
 * B5 / R12：智能精修五个阶段的**最终组装消息**隔离矩阵。
 *
 * 不只断言请求体字段：这里用标记文本走 `buildLlmMessages` 的真实拼装路径
 * （与 `main.ts` 中 `/api/generate` 的档位分支一致），断言 writing 档出现项目长文风 /
 * 冻结文风样本，utility 档不出现，同时任务合同、必要事实与边界材料仍在。
 *
 * 阶段矩阵（prompt-design.md §2，验证规则见 §2.1）：
 *
 * | 阶段 | 项目长写作指导 | 文风样本 | 阶段目标与必要事实 |
 * |---|---|---|---|
 * | inspect | 不注入 | 不注入 | 当前窗、范围/策略、相关要求 |
 * | plan | 不注入 | 不注入 | 简明编辑目标、诊断汇总和必要事实 |
 * | rewrite | 冻结版本 | 冻结适用样本 | 场内交底、首尾、锁、真实邻文 |
 * | review | 不注入 | 不注入 | 明确检查目标、候选、原文和边界 |
 * | repair | 冻结版本 | 冻结适用样本 | 当前具体缺口、目标候选和边界 |
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildLlmMessages, type GenerationContext } from './generation-prompt-assembler';
import { resolveTaskSystemPromptFromContext } from './task-prompt-defaults';
import { pickFrozenStyleSampleBlock } from '../retrieval/knowledge-retrieval';
import type { FrozenReferenceMaterials } from '../retrieval/knowledge-retrieval';

const PROJECT_SYSTEM_MARK = 'PROJSYS-长文风标记-叙述视角与用词偏好';
const STYLE_SAMPLE_MARK = 'STYLESAMPLE-冻结文风样本标记';
const PERSONA_MARK = 'PERSONA-冻结人物卡';
const KNOWLEDGE_MARK = 'KNOWLEDGE-冻结知识';

const FROZEN_MATERIALS: FrozenReferenceMaterials = {
  materials: [],
  promptText: '',
  personaText: `【人物设定】\n${PERSONA_MARK}`,
  knowledgeText: KNOWLEDGE_MARK,
  styleSampleBlock: `【文风参照】\n${STYLE_SAMPLE_MARK}`,
};

interface StageCase {
  templateKey: string;
  /** 是否注入项目长写作指导与文风样本 */
  writingTier: boolean;
  /** 该阶段 user 输入里必须仍在的关键材料（任务合同 / 事实 / 边界） */
  required: string[];
}

const STAGES: StageCase[] = [
  {
    templateKey: 'chapter.refinement.inspect',
    writingTier: false,
    required: ['<diagnosis-window', 'DIAGNOSIS-STRATEGY'],
  },
  {
    templateKey: 'chapter.refinement.plan',
    writingTier: false,
    required: ['<window-result', 'PLAN-NECESSARY-FACT'],
  },
  {
    templateKey: 'chapter.refinement.rewrite',
    writingTier: true,
    required: ['REWRITE-BRIEF', 'REWRITE-LOCK', 'REWRITE-NEIGHBOR'],
  },
  {
    templateKey: 'chapter.refinement.review',
    writingTier: false,
    required: ['REVIEW-CANDIDATE', 'REVIEW-ORIGINAL', 'REVIEW-BOUNDARY'],
  },
  {
    templateKey: 'chapter.refinement.repair',
    writingTier: true,
    required: ['REPAIR-GAP', 'REPAIR-CANDIDATE', 'REPAIR-BOUNDARY'],
  },
];

function userPromptFor(stage: StageCase): string {
  return `<task>${stage.templateKey}</task>\n${stage.required.join('\n')}`;
}

/** 按 main.ts 的档位分支构造最终消息（与线上同一条拼装链路）。 */
function assembleStage(stage: StageCase): { system: string; user: string } {
  const context: GenerationContext = {
    // 项目 systemPromptText 由 run 冻结后覆盖进来；未冻结时是当前项目设置
    systemPromptText: PROJECT_SYSTEM_MARK,
    // utility 档按合同不注入项目长文风（等价于 omit 生效，且不会被 override 重新开启）
    omitProjectSystemPrompt: !stage.writingTier,
    taskSystemPrompt: resolveTaskSystemPromptFromContext({
      templateKey: stage.templateKey,
      systemPromptOverride: `TASKCONTRACT-${stage.templateKey}`,
    }),
    narrativeContext: '',
    frozenReferenceMaterials: {
      personaText: FROZEN_MATERIALS.personaText,
      knowledgeText: FROZEN_MATERIALS.knowledgeText,
      styleSampleBlock: pickFrozenStyleSampleBlock(stage.templateKey, FROZEN_MATERIALS),
    },
  };
  const messages = buildLlmMessages(context, userPromptFor(stage));
  return {
    system: messages.find((message) => message.role === 'system')?.content ?? '',
    user: messages.find((message) => message.role === 'user')?.content ?? '',
  };
}

describe('B5 阶段注入矩阵：最终组装消息', () => {
  for (const stage of STAGES) {
    it(`${stage.templateKey}：${stage.writingTier ? '注入' : '不注入'}文风，任务合同与边界仍在`, () => {
      const { system, user } = assembleStage(stage);

      // 任务级 system（冻结模板）在所有阶段都必须在位
      assert.match(system, new RegExp(`TASKCONTRACT-${stage.templateKey.replace(/\./g, '\\.')}`));

      if (stage.writingTier) {
        assert.match(system, new RegExp(PROJECT_SYSTEM_MARK), '写作档必须注入项目长文风');
        assert.match(user, new RegExp(STYLE_SAMPLE_MARK), '写作档必须注入冻结文风样本');
      } else {
        assert.doesNotMatch(system, new RegExp(PROJECT_SYSTEM_MARK), '工具档不得注入项目长文风');
        assert.doesNotMatch(user, new RegExp(STYLE_SAMPLE_MARK), '工具档不得注入文风样本');
      }

      // 冻结的必要事实与知识仍随消息下发（不因「不注入文风」被删）
      assert.match(user, new RegExp(PERSONA_MARK));
      assert.match(user, new RegExp(KNOWLEDGE_MARK));

      // 阶段目标 / 必要事实 / 边界材料仍在
      for (const required of stage.required) {
        assert.match(user, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      }
    });
  }

  it('项目 system 覆盖（run 冻结）优先于 omit，写作档不会被 omit 关掉', () => {
    const context: GenerationContext = {
      systemPromptText: PROJECT_SYSTEM_MARK,
      omitProjectSystemPrompt: false,
      taskSystemPrompt: 'TASKCONTRACT-chapter.refinement.rewrite',
      narrativeContext: '',
      frozenReferenceMaterials: {
        personaText: FROZEN_MATERIALS.personaText,
        knowledgeText: FROZEN_MATERIALS.knowledgeText,
        styleSampleBlock: pickFrozenStyleSampleBlock(
          'chapter.refinement.rewrite',
          FROZEN_MATERIALS
        ),
      },
    };
    const system = buildLlmMessages(context, 'x').find((m) => m.role === 'system')?.content ?? '';
    assert.match(system, new RegExp(PROJECT_SYSTEM_MARK));
  });

  it('冻结样本为空时写作档也不得凭空注入样本', () => {
    const context: GenerationContext = {
      systemPromptText: PROJECT_SYSTEM_MARK,
      taskSystemPrompt: 'TASKCONTRACT-chapter.refinement.rewrite',
      narrativeContext: '',
      frozenReferenceMaterials: {
        personaText: PERSONA_MARK,
        knowledgeText: KNOWLEDGE_MARK,
        styleSampleBlock: pickFrozenStyleSampleBlock('chapter.refinement.rewrite', {
          ...FROZEN_MATERIALS,
          styleSampleBlock: '',
        }),
      },
    };
    const user = buildLlmMessages(context, 'x').find((m) => m.role === 'user')?.content ?? '';
    assert.doesNotMatch(user, /【文风参照】/);
    assert.match(user, new RegExp(PERSONA_MARK));
  });
});
