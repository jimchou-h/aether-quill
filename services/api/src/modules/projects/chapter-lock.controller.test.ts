import assert from 'node:assert/strict';
import test from 'node:test';
import { RequestMethod } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import 'reflect-metadata';
import { ProjectsController } from './projects.controller';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { ProjectsService } from './projects.service';
import type { ChapterAutoLoopService } from './chapter-auto-loop.service';
import type { DocumentsService } from '../documents/documents.service';

function handlerOf(method: string): (...args: unknown[]) => unknown {
  const descriptor = Object.getOwnPropertyDescriptor(ProjectsController.prototype, method);
  assert.ok(descriptor?.value, `控制器缺少方法 ${method}`);
  return descriptor.value as (...args: unknown[]) => unknown;
}

test('锁定端点注册为 PATCH :id/knowledge/chapters/:chapterNo/lock 且带 JWT 守卫', () => {
  const handler = handlerOf('setChapterLock');
  assert.equal(Reflect.getMetadata(METHOD_METADATA, handler), RequestMethod.PATCH);
  assert.equal(
    Reflect.getMetadata(PATH_METADATA, handler),
    ':id/knowledge/chapters/:chapterNo/lock'
  );
  const guards = Reflect.getMetadata(GUARDS_METADATA, handler) as unknown[];
  assert.ok(Array.isArray(guards) && guards.includes(JwtAuthGuard), '必须使用 JwtAuthGuard');
});

test('锁定处理器把章号转数值并透传 isLocked 与 userId', async () => {
  const calls: unknown[][] = [];
  const stub = {
    setChapterLock: (...args: unknown[]) => {
      calls.push(args);
      return Promise.resolve({ chapterNo: 3, isLocked: true });
    },
  } as unknown as ProjectsService;

  const controller = new ProjectsController(
    stub,
    {} as unknown as ChapterAutoLoopService,
    {} as unknown as DocumentsService
  );
  const result = await controller.setChapterLock('p1', '3', { isLocked: true }, {
    user: { userId: 'u1', email: 'e', name: 'n' },
  } as never);

  assert.deepEqual(result, { chapterNo: 3, isLocked: true });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], ['p1', 3, true, 'u1']);
});
