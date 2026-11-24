import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import type { Request, Response } from 'express';
import { createSseStreamContext } from './sse-stream.util';

function createMockResponse() {
  const emitter = new EventEmitter();
  const chunks: string[] = [];
  const state = { writableEnded: false, destroyed: false };
  const res = {
    get writableEnded() {
      return state.writableEnded;
    },
    get destroyed() {
      return state.destroyed;
    },
    writeHead: () => res,
    write: (chunk: string) => {
      chunks.push(chunk);
      return true;
    },
    end: () => {
      state.writableEnded = true;
      emitter.emit('close');
    },
    on: emitter.on.bind(emitter),
  } as unknown as Response;

  return { res, chunks, state, emitter };
}

test('createSseStreamContext stops writing after request close', () => {
  const req = new EventEmitter() as Request;
  const { res, chunks } = createMockResponse();
  const ctx = createSseStreamContext(req, res);

  assert.equal(ctx.writeEvent({ event: 'start' }), true);
  assert.equal(ctx.abortSignal.aborted, false);
  req.emit('close');
  assert.equal(ctx.isAborted(), true);
  assert.equal(ctx.abortSignal.aborted, true);
  assert.equal(ctx.writeEvent({ event: 'content', data: 'x' }), false);
  assert.ok(chunks.some((chunk) => chunk.includes('data:')));
  ctx.end();
});

test('createSseStreamContext 正常 end 后的 close 不再二次 abort', () => {
  const req = new EventEmitter() as Request;
  const { res } = createMockResponse();
  const ctx = createSseStreamContext(req, res);
  assert.equal(ctx.abortSignal.aborted, false);
  // mock end() 会先置 writableEnded 再 emit close，应被忽略
  ctx.end();
  assert.equal(ctx.abortSignal.aborted, false);
});

test('createSseStreamContext 提前断开（destroyed 且未 end）仍会 abort', () => {
  const req = new EventEmitter() as Request;
  const { res, state, emitter } = createMockResponse();
  const ctx = createSseStreamContext(req, res);
  assert.equal(ctx.abortSignal.aborted, false);

  // 客户端断开时 Node 会销毁响应，但 writableEnded 仍为 false
  state.destroyed = true;
  emitter.emit('close');

  assert.equal(ctx.abortSignal.aborted, true);
  assert.equal(ctx.isAborted(), true);
  ctx.end();
});
