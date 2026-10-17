import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GUARDS_METADATA, HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { NotFoundException } from '@nestjs/common';
import { RequestMethod } from '@nestjs/common';

import { EditorChatController } from './editor-chat.controller';
import { EditorChatAccessDeniedError, type EditorChatService } from './editor-chat.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

function metadataOf(method: string, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(EditorChatController.prototype, method);
  return Reflect.getMetadata(key, descriptor!.value);
}

function fakeReq() {
  return {
    user: { userId: 'u1', email: 'e', name: 'n' },
    on: () => undefined,
    socket: { setNoDelay: () => undefined, setTimeout: () => undefined },
    setTimeout: () => undefined,
  } as never;
}

function fakeRes() {
  return {
    writableEnded: false,
    destroyed: false,
    writeHead: () => undefined,
    write: () => undefined,
    end: () => undefined,
    on: () => undefined,
    socket: { setNoDelay: () => undefined, setTimeout: () => undefined },
    setTimeout: () => undefined,
  } as never;
}

describe('EditorChatController', () => {
  it('exposes POST :id/editor-chat/stream behind JwtAuthGuard with SSE 200', () => {
    assert.equal(metadataOf('stream', METHOD_METADATA), RequestMethod.POST);
    assert.equal(metadataOf('stream', PATH_METADATA), ':id/editor-chat/stream');
    assert.equal(metadataOf('stream', HTTP_CODE_METADATA), 200);
    const guards = metadataOf('stream', GUARDS_METADATA) as unknown[];
    assert.ok(guards.includes(JwtAuthGuard));
  });

  it('surfaces access-denied and missing-chapter errors before the stream is created', async () => {
    const controller = new EditorChatController({
      validate: () => {
        throw new EditorChatAccessDeniedError();
      },
      streamChat: async () => {
        throw new Error('stream must not start after access denial');
      },
    } as unknown as EditorChatService);
    await assert.rejects(
      () => controller.stream('p1', { question: '第7章怎么改' }, fakeReq(), fakeRes()),
      EditorChatAccessDeniedError
    );

    const controller2 = new EditorChatController({
      validate: () => {
        throw new NotFoundException('第 99 章不存在');
      },
      streamChat: async () => {
        throw new Error('stream must not start after 404');
      },
    } as unknown as EditorChatService);
    await assert.rejects(
      () => controller2.stream('p1', { question: '第99章怎么样' }, fakeReq(), fakeRes()),
      NotFoundException
    );
  });

  it('validates then streams with flattened request fields and userId', async () => {
    const order: string[] = [];
    const streamed: unknown[] = [];
    const service = {
      validate: () => {
        order.push('validate');
      },
      streamChat: async (input: unknown) => {
        order.push('streamChat');
        streamed.push(input);
      },
    } as unknown as EditorChatService;
    const controller = new EditorChatController(service);
    await controller.stream(
      'p1',
      { question: ' 第7章怎么改 ', currentChapterNo: 7, history: [{ role: 'user', content: 'hi' }] },
      fakeReq(),
      fakeRes()
    );
    assert.deepEqual(order, ['validate', 'streamChat']);
    const input = streamed[0] as Record<string, unknown>;
    assert.equal(input.projectId, 'p1');
    assert.equal(input.userId, 'u1');
    assert.equal(input.question, ' 第7章怎么改 ');
    assert.equal(input.currentChapterNo, 7);
    assert.deepEqual(input.history, [{ role: 'user', content: 'hi' }]);
    const sse = input.sse as { writeEvent: unknown; end: unknown };
    assert.equal(typeof sse.writeEvent, 'function');
    assert.equal(typeof sse.end, 'function');
  });
});
