import assert from 'node:assert/strict';
import { describe, it, before, after } from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeDocType } from './documents-type.util';
import { DocumentsService } from './documents.service';

describe('normalizeDocType', () => {
  it('defaults to other for invalid values', () => {
    assert.equal(normalizeDocType(undefined), 'other');
    assert.equal(normalizeDocType('invalid'), 'other');
  });

  it('accepts persona_card', () => {
    assert.equal(normalizeDocType('persona_card'), 'persona_card');
  });
});

describe('DocumentsService personaId persistence (AQ-364)', () => {
  const PROJECT_ID = 'project-1';
  const KNOWN_PERSONA_ID = 'persona-1';

  let originalCwd: string;
  let tempDir: string;
  let service: DocumentsService;

  before(() => {
    originalCwd = process.cwd();
    tempDir = mkdtempSync(join(tmpdir(), 'aq-documents-service-test-'));
    process.chdir(tempDir);

    const projectsServiceStub = {
      findOne: (projectId: string) => ({ id: projectId }),
      getPersonas: () => [{ id: KNOWN_PERSONA_ID, name: '林晚' }],
    };
    service = new DocumentsService(projectsServiceStub as never, {} as never);
  });

  after(() => {
    process.chdir(originalCwd);
    rmSync(tempDir, { recursive: true, force: true });
  });

  async function createAndCleanup(
    payload: Parameters<DocumentsService['create']>[1]
  ): ReturnType<DocumentsService['create']> {
    const doc = await service.create(PROJECT_ID, payload);
    // 清理自动索引 debounce 定时器，避免测试进程遗留写盘副作用
    await service.remove(doc.id);
    return doc;
  }

  it('create stores personaId when it references a persona in the project', async () => {
    const doc = await service.create(PROJECT_ID, {
      title: '角色卡：林晚',
      content: '设定内容',
      docType: 'persona_card',
      personaId: KNOWN_PERSONA_ID,
    });
    try {
      assert.equal(doc.personaId, KNOWN_PERSONA_ID);
    } finally {
      await service.remove(doc.id);
    }
  });

  it('create defaults personaId to null when omitted', async () => {
    const doc = await createAndCleanup({
      title: '角色卡：苏眠',
      content: '设定内容',
      docType: 'persona_card',
    });
    assert.equal(doc.personaId, null);
  });

  it('create rejects personaId that does not exist in the project', async () => {
    await assert.rejects(
      () =>
        service.create(PROJECT_ID, {
          title: '角色卡：无名氏',
          content: '设定内容',
          docType: 'persona_card',
          personaId: 'not-a-real-persona',
        }),
      (error: unknown) => error instanceof BadRequestException
    );
  });

  it('update stores personaId on an existing persona_card document', async () => {
    const doc = await service.create(PROJECT_ID, {
      title: '角色卡：安然',
      content: '设定内容',
      docType: 'persona_card',
    });
    try {
      const updated = await service.update(doc.id, { personaId: KNOWN_PERSONA_ID });
      assert.equal(updated.personaId, KNOWN_PERSONA_ID);
    } finally {
      await service.remove(doc.id);
    }
  });

  it('update clears personaId when explicitly set to null', async () => {
    const doc = await service.create(PROJECT_ID, {
      title: '角色卡：沈知',
      content: '设定内容',
      docType: 'persona_card',
      personaId: KNOWN_PERSONA_ID,
    });
    try {
      const updated = await service.update(doc.id, { personaId: null });
      assert.equal(updated.personaId, null);
    } finally {
      await service.remove(doc.id);
    }
  });

  it('leaves personaId untouched when the field is omitted from update', async () => {
    const doc = await service.create(PROJECT_ID, {
      title: '角色卡：顾言',
      content: '设定内容',
      docType: 'persona_card',
      personaId: KNOWN_PERSONA_ID,
    });
    try {
      const updated = await service.update(doc.id, { title: '角色卡：顾言（修订）' });
      assert.equal(updated.personaId, KNOWN_PERSONA_ID);
    } finally {
      await service.remove(doc.id);
    }
  });
});
