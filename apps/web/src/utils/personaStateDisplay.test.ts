import assert from 'node:assert/strict';
import test from 'node:test';
import { formatPersonaStateDisplay } from './personaStateDisplay';

test('formatPersonaStateDisplay converts snapshot json', () => {
  const raw =
    '{"clothing":"穿着休闲装（长裤和T恤）","appearance":"顶级神颜，180cm，肌肉发达，8块腹';
  const display = formatPersonaStateDisplay(raw);
  assert.ok(display.includes('着装：穿着休闲装'));
  assert.ok(display.includes('外貌：顶级神颜'));
  assert.equal(display.startsWith('{'), false);
});
