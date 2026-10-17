import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { extractChapterNoFromQuestion } from './editor-chat-chapter.util';

describe('extractChapterNoFromQuestion', () => {
  it('parses arabic numeral chapter mention', () => {
    assert.equal(extractChapterNoFromQuestion('第7章有什么优化想法'), 7);
  });

  it('parses chinese numeral chapter mention', () => {
    assert.equal(extractChapterNoFromQuestion('第七章节奏太慢，怎么改'), 7);
    assert.equal(extractChapterNoFromQuestion('第十二章的对话'), 12);
    assert.equal(extractChapterNoFromQuestion('第三十一章开头'), 31);
  });

  it('returns the first explicit mention when several appear', () => {
    assert.equal(extractChapterNoFromQuestion('对比第3章和第9章'), 3);
  });

  it('returns null when no explicit chapter anchor exists', () => {
    assert.equal(extractChapterNoFromQuestion('刚才第二条怎么改'), null);
    assert.equal(extractChapterNoFromQuestion(''), null);
  });

  it('rejects zero and non-positive numbers', () => {
    assert.equal(extractChapterNoFromQuestion('第0章'), null);
  });
});
