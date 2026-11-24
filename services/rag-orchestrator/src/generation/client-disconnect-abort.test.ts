import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { bindClientDisconnectAbort } from './client-disconnect-abort';

class MockResponse extends EventEmitter {
  destroyed: boolean;

  constructor(
    public writableEnded: boolean,
    destroyed = false
  ) {
    super();
    this.destroyed = destroyed;
  }
}

test('注册监听前已断开时，绑定后立即取消上游生成', () => {
  const req = new EventEmitter();
  const res = new MockResponse(false, true);
  const controller = new AbortController();
  const binding = bindClientDisconnectAbort(req, res, controller);

  assert.equal(controller.signal.aborted, true);
  binding.dispose();
});

test('已正常结束的响应即使 destroyed 也不取消', () => {
  const req = new EventEmitter();
  const res = new MockResponse(true, true);
  const controller = new AbortController();
  const binding = bindClientDisconnectAbort(req, res, controller);

  assert.equal(controller.signal.aborted, false);
  binding.dispose();
});

test('提前断开（未 end）时取消上游生成', () => {
  const req = new EventEmitter();
  const res = new MockResponse(false);
  const controller = new AbortController();
  const binding = bindClientDisconnectAbort(req, res, controller);

  res.emit('close');

  assert.equal(controller.signal.aborted, true);
  binding.dispose();
});

test('正常 end 后的 close 不取消生成', () => {
  const req = new EventEmitter();
  const res = new MockResponse(true);
  const controller = new AbortController();
  const binding = bindClientDisconnectAbort(req, res, controller);

  res.emit('close');

  assert.equal(controller.signal.aborted, false);
  binding.dispose();
});

test('dispose 后不再响应 close', () => {
  const req = new EventEmitter();
  const res = new MockResponse(false);
  const controller = new AbortController();
  const binding = bindClientDisconnectAbort(req, res, controller);

  binding.dispose();
  res.emit('close');

  assert.equal(controller.signal.aborted, false);
});
