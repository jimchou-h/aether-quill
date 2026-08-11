import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { AuthService } from './auth.service';

function createJwtServiceMock() {
  let seq = 0;
  return {
    sign: (_payload: unknown, options?: { expiresIn?: string }) => {
      seq += 1;
      const expSeconds = options?.expiresIn === '30m' ? 30 * 60 : 7 * 24 * 60 * 60;
      return `${options?.expiresIn ?? 'token'}-${seq}-${expSeconds}`;
    },
    decode: (token: string) => {
      const parts = token.split('-');
      const expSeconds = Number(parts.at(-1) ?? 0);
      return {
        exp: Math.floor(Date.now() / 1000) + expSeconds,
      };
    },
    verify: () => ({ sub: '1', email: 'admin@example.com', name: 'Admin User' }),
  };
}

test('auth sessions persist to disk and survive service recreation', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'aq-auth-'));
  const storagePath = join(tempDir, 'auth-sessions.json');
  try {
    const jwtService = createJwtServiceMock();
    const prisma = {} as never;

    const first = new AuthService(jwtService as never, prisma);
    (first as unknown as { storagePath: string }).storagePath = storagePath;
    const login = await first.login('admin@example.com', 'password123');

    assert.ok(existsSync(storagePath));
    assert.ok(statSync(storagePath).size > 0);

    const second = new AuthService(jwtService as never, prisma);
    (second as unknown as { storagePath: string }).storagePath = storagePath;
    (second as unknown as { restoreSessionsFromDisk: () => void }).restoreSessionsFromDisk();

    const refreshed = await second.refreshToken(login.refreshToken);
    assert.ok(refreshed.accessToken);
    assert.ok(refreshed.refreshToken);
    assert.notEqual(refreshed.refreshToken, login.refreshToken);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('generation preferences round-trip on auth service (memory + disk)', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'aq-auth-prefs-'));
  const prefsPath = join(tempDir, 'user-generation-preferences.json');
  try {
    const jwtService = createJwtServiceMock();
    const prisma = {} as never;
    const service = new AuthService(jwtService as never, prisma);
    (service as unknown as { preferencesStoragePath: string }).preferencesStoragePath = prefsPath;

    const defaults = service.getGenerationPreferences('1');
    assert.equal(defaults.writing.provider, 'deepseek');
    assert.equal(defaults.writing.model, 'deepseek-v4-flash');
    assert.equal(defaults.writing.temperature, 0.7);
    assert.equal(defaults.utility.model, 'deepseek-v4-flash');
    assert.equal(defaults.utility.temperature, 0.7);

    const saved = await service.updateGenerationPreferences('1', {
      writing: {
        provider: 'siliconflow',
        model: 'Qwen/Qwen2.5-72B-Instruct',
        temperature: 0.88,
      },
      utility: {
        provider: 'deepseek',
        model: 'deepseek-chat',
        temperature: 0.35,
      },
    });
    assert.equal(saved.writing.provider, 'siliconflow');
    assert.equal(saved.utility.model, 'deepseek-chat');
    assert.ok(existsSync(prefsPath));

    const again = new AuthService(jwtService as never, prisma);
    (again as unknown as { preferencesStoragePath: string }).preferencesStoragePath = prefsPath;
    (again as unknown as { restorePreferencesFromDisk: () => void }).restorePreferencesFromDisk();
    const loaded = again.getGenerationPreferences('1');
    assert.equal(loaded.writing.provider, 'siliconflow');
    assert.equal(loaded.writing.temperature, 0.88);
    assert.equal(loaded.utility.temperature, 0.35);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
