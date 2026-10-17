import assert from 'node:assert/strict';
import test from 'node:test';
import { HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { ChapterRefinementController } from './chapter-refinement.controller';
import type { ChapterRefinementService } from './chapter-refinement.service';

/**
 * W4：控制器成功状态码必须与 openapi/paths/projects/chapter-refinement-*.yaml 对齐。
 *
 * 纯 service 返回值测试无法覆盖控制器 HTTP 状态；这里直接读取 Nest
 * `@HttpCode` / `@Post` 元数据，断言实际响应码与合同一致（不依赖真实 HTTP 服务）。
 */
function handlerOf(prototype: object, method: string): { name: string } {
  const descriptor = Object.getOwnPropertyDescriptor(prototype, method);
  assert.ok(descriptor?.value, `控制器缺少方法 ${method}`);
  return { name: method };
}

function httpCodeOf(method: string): number | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(ChapterRefinementController.prototype, method);
  return Reflect.getMetadata(HTTP_CODE_METADATA, descriptor!.value) as number | undefined;
}

function requestMethodOf(method: string): RequestMethod | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(ChapterRefinementController.prototype, method);
  return Reflect.getMetadata(METHOD_METADATA, descriptor!.value) as RequestMethod | undefined;
}

function pathOf(method: string): string | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(ChapterRefinementController.prototype, method);
  return Reflect.getMetadata(PATH_METADATA, descriptor!.value) as string | undefined;
}

test('W4：创建 run 成功状态为 202（Nest 默认 201 必须显式覆盖）', () => {
  handlerOf(ChapterRefinementController.prototype, 'createRun');
  assert.equal(requestMethodOf('createRun'), RequestMethod.POST);
  assert.equal(httpCodeOf('createRun'), 202);
  assert.match(pathOf('createRun') ?? '', /refinement\/runs$/);
});

test('5.1：resume 成功状态为 202，cancel / discard 为 200', () => {
  assert.equal(requestMethodOf('resumeRun'), RequestMethod.POST);
  assert.equal(httpCodeOf('resumeRun'), 202);

  assert.equal(requestMethodOf('cancelRun'), RequestMethod.POST);
  assert.equal(httpCodeOf('cancelRun'), 200);

  assert.equal(requestMethodOf('discardRun'), RequestMethod.POST);
  assert.equal(httpCodeOf('discardRun'), 200);
});

/**
 * 控制器成功状态码与 OpenAPI 合同必须一致；create 与 resume 为 202，cancel/discard 为 200。
 * 为防止元数据在重构中悄然回归，这里以最小 stub service 直接调用处理器，确认「调用成功即返回」。
 */
test('W4：createRun 处理器在无异常时返回 service 结果（状态由 @HttpCode(202) 决定）', async () => {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const stub = {
    createRun: (...args: unknown[]) => {
      calls.push({ method: 'createRun', args });
      return Promise.resolve({ runId: 'run-1', status: 'queued' });
    },
  } as unknown as ChapterRefinementService;

  const controller = new ChapterRefinementController(stub);
  const result = await controller.createRun(
    'p1',
    '3',
    {} as never,
    {
      user: { userId: 'u1', email: 'e', name: 'n' },
      traceId: 'trace-1',
    } as never
  );

  assert.deepEqual(result, { runId: 'run-1', status: 'queued' });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, ['p1', 3, {}, 'u1', 'trace-1']);
});
