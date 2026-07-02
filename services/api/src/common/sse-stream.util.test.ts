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

  return { res, chunks };
}

test('createSseStreamContext stops writing after request close', () => {
  const req = new EventEmitter() as Request;
  const { res, chunks } = createMockResponse();
  const ctx = createSseStreamContext(req, res);

  assert.equal(ctx.writeEvent({ event: 'start' }), true);
  req.emit('close');
  assert.equal(ctx.isAborted(), true);
  assert.equal(ctx.writeEvent({ event: 'content', data: 'x' }), false);
  assert.equal(chunks.length, 2);
});
