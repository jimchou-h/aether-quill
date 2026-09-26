import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizePromptTemplateText,
  promptTemplateUpdateChanged,
  resolveEffectiveSystemPromptContent,
  pickLatestPublishedContent,
  pickSystemTemplate,
  isBlankPromptText,
} from './prompt-template-draft.util';

test('换行符不同不视为改动', () => {
  assert.equal(normalizePromptTemplateText('a\r\nb'), 'a\nb');
  assert.equal(
    promptTemplateUpdateChanged({
      currentContent: '角色声明\n第二行',
      currentName: '系统默认模板',
      nextContent: '角色声明\r\n第二行',
    }),
    false
  );
});

test('正文或名称有实质改动才记新草稿', () => {
  assert.equal(
    promptTemplateUpdateChanged({
      currentContent: '已发布稿',
      currentName: '系统默认模板',
      nextContent: '已发布稿',
    }),
    false
  );
  assert.equal(
    promptTemplateUpdateChanged({
      currentContent: '已发布稿',
      currentName: '系统默认模板',
      nextContent: '新草稿',
    }),
    true
  );
});

test('已发布模板运行时用当前正文；草稿态回退最近一份已发布', () => {
  assert.equal(
    resolveEffectiveSystemPromptContent(
      { content: '当前草稿', isPublished: false },
      [
        { content: '旧已发布', isPublished: true },
        { content: '当前草稿', isPublished: false },
      ],
      'settings 备份'
    ),
    '旧已发布'
  );
  assert.equal(
    resolveEffectiveSystemPromptContent(
      { content: '已发布正文', isPublished: true },
      [{ content: '已发布正文', isPublished: true }],
      'settings 备份'
    ),
    '已发布正文'
  );
});

test('多个已发布标记时取最后一份非空稿，跳过空稿和早期默认稿', () => {
  assert.equal(
    pickLatestPublishedContent([
      { content: '你是一位专业的小说写作助手。请帮助用户进行小说创作，保持逻辑连贯和设定一致性。', isPublished: true },
      { content: '', isPublished: true },
      { content: '长稿角色声明', isPublished: true },
      { content: '未发布草稿', isPublished: false },
    ]),
    '长稿角色声明'
  );
  assert.equal(
    pickSystemTemplate([
      { category: 'chapter', isPublished: true, content: '章节' },
      { category: 'system', isPublished: false, content: '' },
      { category: 'system', isPublished: true, content: '已发布系统稿' },
    ])?.content,
    '已发布系统稿'
  );
  assert.equal(isBlankPromptText('   '), true);
  assert.equal(isBlankPromptText('有内容'), false);
});
