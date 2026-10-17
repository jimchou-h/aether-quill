import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const OPENAPI_PATH = path.resolve(__dirname, '../../../../../openapi/openapi.yaml');
const STREAM_PATH = path.resolve(__dirname, '../../../../../openapi/paths/projects/editor-chat-stream.yaml');

test('editor chat stream path is registered and refed', () => {
  const yaml = readOpenapi();
  assert.match(yaml, /\/api\/projects\/\{id\}\/editor-chat\/stream:/);
  assert.match(yaml, /editor-chat-stream\.yaml/);
  const body = readFileSync(STREAM_PATH, 'utf8');
  assert.match(body, /\$ref: '\.\.\/\.\.\/openapi\.yaml#\/components\/schemas\/EditorChatStreamRequest'/);
  assert.match(body, /text\/event-stream/);
});

test('EditorChatStreamRequest schema locks required fields and history bounds', () => {
  const yaml = readOpenapi();
  const start = yaml.indexOf('EditorChatStreamRequest:');
  assert.ok(start >= 0, 'EditorChatStreamRequest schema missing');
  const schema = yaml.slice(start, start + 2_000);
  const required = schema.match(/required:([\s\S]*?)\r?\n\s{6}properties:/);
  assert.ok(required, 'EditorChatStreamRequest.required missing');
  assert.match(required[1], /\bquestion\b/);
  assert.doesNotMatch(required[1], /\bhistory\b/);
  assert.doesNotMatch(required[1], /\bcurrentChapterNo\b/);
  assert.match(schema, /question:[\s\S]*?maxLength: \d{3,}/);
  assert.match(schema, /maxItems: 24/);
  assert.match(schema, /enum:[\s\S]*?user[\s\S]*?assistant/);
  assert.match(schema, /currentChapterNo:[\s\S]*?minimum: 1/);
});

function readOpenapi(): string {
  return readFileSync(OPENAPI_PATH, 'utf8');
}
