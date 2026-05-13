import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  normalizePersonaUpdateInput,
  resolveActivePersonaIdAfterDelete,
} from './persona-management.util';

describe('persona-management.util', () => {
  it('trims persona update fields', () => {
    assert.deepEqual(
      normalizePersonaUpdateInput({
        name: ' 沈镜川 ',
        profile: ' 冷静克制 ',
        state: ' 清醒 ',
      }),
      {
        name: '沈镜川',
        profile: '冷静克制',
        state: '清醒',
      }
    );
  });

  it('clears activePersonaId when deleting the active persona', () => {
    assert.equal(resolveActivePersonaIdAfterDelete('persona-1', 'persona-1'), null);
    assert.equal(resolveActivePersonaIdAfterDelete('persona-2', 'persona-1'), 'persona-2');
    assert.equal(resolveActivePersonaIdAfterDelete(null, 'persona-1'), null);
  });
});
