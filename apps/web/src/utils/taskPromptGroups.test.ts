import assert from 'node:assert/strict';
import test from 'node:test';
import {
  describeRefinementTier,
  groupTaskPromptItems,
  REFINEMENT_TASK_ROLES,
  resolveRefinementTaskRole,
  resolveTaskPromptGroupId,
  TASK_PROMPT_GROUP_DEFINITIONS,
} from './taskPromptGroups';
import type { TaskPromptListItem } from '../services/api';

function item(templateKey: string): TaskPromptListItem {
  return {
    templateKey,
    name: templateKey,
    defaultText: 'default',
    draftText: 'draft',
    publishedText: 'published',
    hasCustomPublished: false,
    hasCustomDraft: false,
    version: 1,
  };
}

test('resolveTaskPromptGroupId maps writing keys only', () => {
  assert.equal(resolveTaskPromptGroupId('chapter.optimize.plan'), 'writing');
  assert.equal(resolveTaskPromptGroupId('chapter.optimize.direct-draft'), 'writing');
  assert.equal(resolveTaskPromptGroupId('chapter.pipeline.sensory.rewrite'), null);
  assert.equal(resolveTaskPromptGroupId('chapter.compliance.outline'), null);
  assert.equal(resolveTaskPromptGroupId('chapter.pipeline.rules.fix'), null);
  assert.equal(resolveTaskPromptGroupId('chapter.pipeline.character'), null);
});

test('auto-loop prompts land in the existing writing group', () => {
  assert.equal(resolveTaskPromptGroupId('chapter.optimize.loop.plan'), 'writing');
  assert.equal(resolveTaskPromptGroupId('chapter.optimize.loop.draft'), 'writing');
});

test('workbench prompts land in the existing writing group', () => {
  assert.equal(resolveTaskPromptGroupId('chapter.optimize.workbench-draft-sex'), 'writing');
  assert.equal(resolveTaskPromptGroupId('chapter.optimize.workbench-draft-prose'), 'writing');
  assert.equal(resolveTaskPromptGroupId('chapter.optimize.workbench-review'), 'writing');
  assert.equal(resolveTaskPromptGroupId('chapter.optimize.workbench-fix-span'), 'writing');
});

test('groupTaskPromptItems buckets writing items and drops cut-stack keys', () => {
  const grouped = groupTaskPromptItems([
    item('chapter.optimize.draft'),
    item('chapter.optimize.direct-draft'),
    item('chapter.pipeline.character'),
    item('chapter.compliance.rewrite'),
    item('chapter.pipeline.sensory.rewrite'),
    item('chapter.pipeline.rules.fix'),
  ]);
  assert.equal(grouped.writing.length, 2);
  assert.ok(grouped.writing.some((entry) => entry.templateKey === 'chapter.optimize.direct-draft'));
});

test('TASK_PROMPT_GROUP_DEFINITIONS keeps writing first', () => {
  assert.equal(TASK_PROMPT_GROUP_DEFINITIONS[0]?.id, 'writing');
  assert.equal(TASK_PROMPT_GROUP_DEFINITIONS[0]?.title, '文笔优化');
});

// ── B5：智能精修五模板的分组、职责与档位 ──────────────────────────────

test('B5 智能精修五模板各自成组，旧文笔优化分组仍在', () => {
  const ids = TASK_PROMPT_GROUP_DEFINITIONS.map((group) => group.id);
  assert.deepEqual(ids, ['writing', 'refinement']);
  for (const role of REFINEMENT_TASK_ROLES) {
    assert.equal(resolveTaskPromptGroupId(role.templateKey), 'refinement');
  }
  // 旧任务键仍落在原分组，不被新分组吞掉
  assert.equal(resolveTaskPromptGroupId('chapter.optimize.draft'), 'writing');
});

test('B5 五模板职责与档位：utility 不注入文风，writing 注入', () => {
  const tiers = new Map(REFINEMENT_TASK_ROLES.map((role) => [role.templateKey, role.tier]));
  assert.equal(tiers.get('chapter.refinement.inspect'), 'utility');
  assert.equal(tiers.get('chapter.refinement.plan'), 'utility');
  assert.equal(tiers.get('chapter.refinement.review'), 'utility');
  assert.equal(tiers.get('chapter.refinement.rewrite'), 'writing');
  assert.equal(tiers.get('chapter.refinement.repair'), 'writing');
  // 每个模板都要有可展示的职责说明
  for (const role of REFINEMENT_TASK_ROLES) {
    assert.ok(role.duty.trim().length > 0, `${role.templateKey} 缺职责说明`);
  }
  assert.equal(describeRefinementTier('chapter.refinement.rewrite'), '写作档（注入文风）');
  assert.equal(describeRefinementTier('chapter.refinement.review'), '工具档（不注入文风）');
  assert.equal(describeRefinementTier('chapter.optimize.draft'), null);
  assert.equal(resolveRefinementTaskRole('chapter.optimize.draft'), null);
});

test('B5 分组结果：精修五模板与旧任务互不串组', () => {
  const grouped = groupTaskPromptItems([
    item('chapter.optimize.draft'),
    item('chapter.refinement.inspect'),
    item('chapter.refinement.plan'),
    item('chapter.refinement.rewrite'),
    item('chapter.refinement.review'),
    item('chapter.refinement.repair'),
    item('chapter.pipeline.character'),
  ]);
  assert.equal(grouped.refinement.length, 5, '五个精修模板都应可见');
  assert.equal(grouped.writing.length, 1, '旧文笔优化模板仍留在原分组');
  assert.deepEqual(
    grouped.refinement.map((entry) => entry.templateKey),
    [
      'chapter.refinement.inspect',
      'chapter.refinement.plan',
      'chapter.refinement.rewrite',
      'chapter.refinement.review',
      'chapter.refinement.repair',
    ]
  );
});
