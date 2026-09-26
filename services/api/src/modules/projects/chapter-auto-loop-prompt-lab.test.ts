import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyAdviseToLayer,
  attachPromptLabCallIds,
  buildAdviseUserPrompt,
  buildPromptLabAdviseRequest,
  buildPromptLabReplayRequest,
  findPromptLabCall,
  parseAdviseResponse,
  templateKeyForPromptLabKind,
  type AutoLoopPromptLabCall,
} from './chapter-auto-loop-prompt-lab';

function call(overrides: Partial<AutoLoopPromptLabCall> = {}): AutoLoopPromptLabCall {
  return {
    id: 'lab-1',
    kind: 'diagnose',
    templateKey: 'chapter.optimize.loop.plan',
    roundIndex: 1,
    windowIndex: 1,
    userPrompt: 'user',
    taskPromptText: 'system',
    output: 'out',
    frozenRetrievedEvidence: 'ev',
    createdAt: '2026-09-11T00:00:00.000Z',
    ...overrides,
  };
}

test('findPromptLabCall 按窗+轮绑定诊断，不串到下一窗同轮号', () => {
  const calls = [
    call({ id: 'a', windowIndex: 1, roundIndex: 1 }),
    call({ id: 'b', windowIndex: 2, roundIndex: 1 }),
  ];
  assert.equal(
    findPromptLabCall(calls, { kind: 'diagnose', roundIndex: 1, windowIndex: 1 })?.id,
    'a'
  );
  assert.equal(
    findPromptLabCall(calls, { kind: 'diagnose', roundIndex: 1, windowIndex: 2 })?.id,
    'b'
  );
});

test('findPromptLabCall 同窗同轮多次诊断取最后一次', () => {
  const calls = [
    call({ id: 'first', windowIndex: 1, roundIndex: 1 }),
    call({ id: 'retry', windowIndex: 1, roundIndex: 1 }),
  ];
  assert.equal(
    findPromptLabCall(calls, { kind: 'diagnose', roundIndex: 1, windowIndex: 1 })?.id,
    'retry'
  );
});

test('attachPromptLabCallIds 把诊断与改写快照挂到轮次和条目', () => {
  const calls = [
    call({ id: 'diag-1', kind: 'diagnose', roundIndex: 2, windowIndex: 1 }),
    call({
      id: 'rw-3',
      kind: 'rewrite',
      templateKey: 'chapter.optimize.loop.draft',
      roundIndex: 2,
      windowIndex: 1,
      paragraphIndex: 3,
    }),
  ];
  const input = {
    roundIndex: 2,
    windowIndex: 1,
    promptLabCallId: undefined as string | undefined,
    items: [
      { paragraphIndex: 3, promptLabCallId: undefined as string | undefined },
      { paragraphIndex: 8, promptLabCallId: undefined as string | undefined },
    ],
  };
  const stamped = attachPromptLabCallIds(input, calls);
  assert.equal(stamped.promptLabCallId, 'diag-1');
  assert.equal(stamped.items[0]?.promptLabCallId, 'rw-3');
  assert.equal(stamped.items[1]?.promptLabCallId, undefined);
});

test('findPromptLabCall 改写按段落号区分', () => {
  const calls = [
    call({
      id: 'p3',
      kind: 'rewrite',
      templateKey: 'chapter.optimize.loop.draft',
      paragraphIndex: 3,
    }),
    call({
      id: 'p7',
      kind: 'rewrite',
      templateKey: 'chapter.optimize.loop.draft',
      paragraphIndex: 7,
    }),
  ];
  assert.equal(
    findPromptLabCall(calls, {
      kind: 'rewrite',
      roundIndex: 1,
      paragraphIndex: 7,
    })?.id,
    'p7'
  );
});

test('templateKeyForPromptLabKind 分别指向诊断与改写任务 Prompt', () => {
  assert.equal(templateKeyForPromptLabKind('diagnose'), 'chapter.optimize.loop.plan');
  assert.equal(templateKeyForPromptLabKind('rewrite'), 'chapter.optimize.loop.draft');
});

test('parseAdviseResponse 接受纯 JSON', () => {
  const parsed = parseAdviseResponse(
    '{"suggestedLayer":"diagnose","suggestedText":"只抓动作节奏","rationale":"去掉语气"}'
  );
  assert.equal(parsed.suggestedLayer, 'diagnose');
  assert.equal(parsed.suggestedText, '只抓动作节奏');
  assert.equal(parsed.rationale, '去掉语气');
});

test('parseAdviseResponse 非法文本抛错', () => {
  assert.throws(() => parseAdviseResponse('我觉得可以改改'), /未返回可解析/);
});

test('parseAdviseResponse 容忍 SSE 把 JSON 字符串里的 \\n 还原成真实换行', () => {
  const compact =
    '{"suggestedLayer":"diagnose","suggestedText":"第一行\\n第二行","rationale":"去掉语气"}';
  const unescaped = compact.replace(/\\n/g, '\n');
  assert.match(unescaped, /\n/);
  const parsed = parseAdviseResponse(unescaped);
  assert.equal(parsed.suggestedLayer, 'diagnose');
  assert.equal(parsed.suggestedText, '第一行\n第二行');
  assert.equal(parsed.rationale, '去掉语气');
});

test('applyAdviseToLayer 点选才写入对应层，失败保留原文', () => {
  const current = { projectSystem: '旧 system', diagnose: '旧诊断' };
  assert.deepEqual(applyAdviseToLayer(current, new Error('x'), 'diagnose'), current);
  assert.deepEqual(
    applyAdviseToLayer(
      current,
      { suggestedLayer: 'diagnose', suggestedText: '新诊断', rationale: '' },
      'diagnose'
    ),
    { projectSystem: '旧 system', diagnose: '新诊断' }
  );
  assert.deepEqual(
    applyAdviseToLayer(
      current,
      { suggestedLayer: 'diagnose', suggestedText: '新 system', rationale: '' },
      'project_system'
    ),
    { projectSystem: '新 system', diagnose: '旧诊断' }
  );
});

test('buildAdviseUserPrompt 同时带上原输出与最新重跑', () => {
  const text = buildAdviseUserPrompt({
    userPrompt: '冻住的 user',
    originalOutput: '原输出A',
    latestReplayOutput: '重跑B',
    projectSystemText: '项目 system',
    taskPromptText: '当前诊断',
    message: '别再抓语气',
    history: [],
  });
  assert.match(text, /【当前项目 system】[\s\S]*项目 system/);
  assert.match(text, /【原输出】[\s\S]*原输出A/);
  assert.match(text, /【最新重跑输出】[\s\S]*重跑B/);
  assert.match(text, /别再抓语气/);
});

test('buildPromptLabReplayRequest 冻住检索并覆盖任务 Prompt 与项目 system，不带章节正文写入', () => {
  const request = buildPromptLabReplayRequest(
    call({
      frozenRetrievedEvidence: '宴会厅陈设',
      userPrompt: '只读 user',
      windowIndex: 2,
      windowTotal: 3,
    }),
    '新的诊断 Prompt',
    '新的项目 system'
  );
  assert.equal(request.prompt, '只读 user');
  assert.equal(request.systemPromptOverride, '新的诊断 Prompt');
  assert.equal(request.context.frozenRetrievedEvidence, '宴会厅陈设');
  assert.equal(request.context.projectSystemPromptOverride, '新的项目 system');
  assert.equal(request.context.windowIndex, 2);
  assert.equal(request.context.windowTotal, 3);
  assert.equal('chapterContent' in request, false);
  assert.equal('apply' in request, false);
});

test('buildPromptLabAdviseRequest 用工具档模板，不复用改写写作模板', () => {
  const request = buildPromptLabAdviseRequest({
    userPrompt: '冻住的 user',
    originalOutput: '原输出A',
    latestReplayOutput: '重跑B',
    projectSystemText: '项目 system',
    taskPromptText: '当前诊断',
    message: '别再抓语气',
    history: [],
  });
  assert.equal(request.templateKey, 'prompt-lab.advise');
  assert.notEqual(request.templateKey, 'chapter.optimize.loop.draft');
  assert.equal(request.context.omitProjectSystemPrompt, true);
  assert.match(request.prompt, /别再抓语气/);
});
