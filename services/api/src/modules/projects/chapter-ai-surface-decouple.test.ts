import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { buildChapterPersonaPromptBlock } from './chapter-persona-prompt.util';

test('buildChapterPersonaPromptBlock keeps published persona and card injection', () => {
  const block = buildChapterPersonaPromptBlock(
    [{ id: 'p1', name: '甲', profile: '设定A', state: '平静', status: 'published' }],
    undefined,
    {
      sourceText: '甲笑了。',
      cards: [{ personaId: 'p1', title: '甲角色卡', content: '右侧梨涡。' }],
    }
  );
  assert.match(block, /甲：设定A/);
  assert.match(block, /右侧梨涡/);
});

test('chapter-auto-loop.service no longer imports pipeline session or compliance product util', () => {
  const source = readFileSync(path.resolve(__dirname, './chapter-auto-loop.service.ts'), 'utf8');
  assert.equal(source.includes("from './chapter-pipeline-session.store'"), false);
  assert.equal(source.includes("from './compliance-check.util'"), false);
  assert.equal(source.includes("from './chapter-generation-stream.client'"), true);
  assert.equal(source.includes("from './chapter-persona-prompt.util'"), true);
});
