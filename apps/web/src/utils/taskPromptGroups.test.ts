import assert from 'node:assert/strict';
import test from 'node:test';
import {
  groupTaskPromptItems,
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

test('TASK_PROMPT_GROUP_DEFINITIONS includes only writing', () => {
  assert.equal(TASK_PROMPT_GROUP_DEFINITIONS.length, 1);
  assert.equal(TASK_PROMPT_GROUP_DEFINITIONS[0]?.id, 'writing');
  assert.equal(TASK_PROMPT_GROUP_DEFINITIONS[0]?.title, '文笔优化');
});
