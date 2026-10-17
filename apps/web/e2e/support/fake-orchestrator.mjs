/**
 * B4：可控假编排器（脚本模型）。
 *
 * 只替换「模型」这一段，其余链路全部真实：真实 Web → 真实 API → 真实
 * ChapterRefinementService / engine → 真实 OrchestratorRefinementGateway → 真实 SSE
 * → 本服务 → 真实 apply。浏览器侧不 mock API 响应。
 *
 * 启动（端口可用 0 自动分配）：
 *
 * ```powershell
 * node apps/web/e2e/support/fake-orchestrator.mjs --port 4409
 * ```
 *
 * 控制接口（供 e2e 用例在运行时改变脚本）：
 * - `POST /__control` body: `{ inspect?, plan?, rewrite?: string[], review?: string[], repair?: string, hang?: string[], fail?: string[] }`
 * - `GET /__calls` 返回已收到的调用（templateKey / prompt 长度），便于断言「作者未继续前调用为零」。
 * - `POST /__reset` 清空调用记录与脚本。
 *
 * `hang` 中的 templateKey 调用会挂起到客户端断开（用于取消 / 重启场景）。
 * `fail` 中的 templateKey 调用返回上游错误。
 */

import http from 'node:http';

const args = process.argv.slice(2);
const portArgIndex = args.indexOf('--port');
const port = portArgIndex >= 0 ? Number(args[portArgIndex + 1]) : 4409;

const state = {
  script: {},
  hang: new Set(),
  fail: new Set(),
  // hangAfterNth: { templateKey: n } —— 该模板的前 n 次调用正常返回，之后挂起。
  // 用于「已接受一段、下一段在途」这类停靠点，而不是一上来就挂住整个阶段。
  hangAfterNth: {},
  failAfterNth: {},
  calls: [],
};

function defaultScriptFor(templateKey) {
  if (templateKey.endsWith('.inspect')) {
    // 隔离中性章节有三个 SourceBlock：b0 是标题，b1 / b2 是两段正文。
    // 必须覆盖真实 block 的三场规划，否则合并后只有一个场景，plan 无法产生
    // 两次改写，用例 2 的「第一段已接受、第二段在途」停靠点永远不可达。
    return JSON.stringify({
      windowId: 'w0',
      sceneFragments: [
        {
          startBlockId: 'b0',
          endBlockId: 'b0',
          startsNewScene: true,
          confidence: 'high',
          goal: '章节标题，保持不动',
          entryFacts: [],
          exitFacts: [],
          proposedBeatEnds: [],
        },
        {
          startBlockId: 'b1',
          endBlockId: 'b1',
          startsNewScene: true,
          confidence: 'high',
          goal: '推进第一场（院中会面）',
          entryFacts: [],
          exitFacts: [],
          proposedBeatEnds: [],
        },
        {
          startBlockId: 'b2',
          endBlockId: 'b2',
          startsNewScene: true,
          confidence: 'high',
          goal: '推进第二场（送别关门）',
          entryFacts: [],
          exitFacts: [],
          proposedBeatEnds: [],
        },
      ],
      issues: [],
    });
  }
  if (templateKey.endsWith('.plan')) {
    // 标题 keep，两段正文各自 rewrite：产生 3 个 unit（u0 keep、u1/u2 rewrite），
    // 即两次独立的 rewrite 调用。sceneId 与 mergeWindowSceneFragments 的
    // 顺序号（scene-1..scene-3）一一对应。
    return JSON.stringify({
      chapterIntent: '收紧节奏，保持剧情与人物状态不变',
      protectedFacts: [],
      sceneBriefs: [
        {
          sceneId: 'scene-1',
          sourceBlockIds: ['b0'],
          decision: 'keep',
          reason: '标题保持不变',
          editIntent: '',
          expectedChange: '',
          entryFacts: [],
          exitFacts: [],
          protectedSpanIds: [],
          targetLength: { direction: 'hold' },
          checks: [],
        },
        {
          sceneId: 'scene-2',
          sourceBlockIds: ['b1'],
          decision: 'rewrite',
          reason: '啰嗦',
          editIntent: '压缩第一段',
          expectedChange: '更短',
          entryFacts: [],
          exitFacts: [],
          protectedSpanIds: [],
          targetLength: { direction: 'hold' },
          checks: [],
        },
        {
          sceneId: 'scene-3',
          sourceBlockIds: ['b2'],
          decision: 'rewrite',
          reason: '啰嗦',
          editIntent: '压缩第二段',
          expectedChange: '更短',
          entryFacts: [],
          exitFacts: [],
          protectedSpanIds: [],
          targetLength: { direction: 'hold' },
          checks: [],
        },
      ],
    });
  }
  if (templateKey.endsWith('.review')) {
    return JSON.stringify({ issues: [], exitStateFacts: [] });
  }
  return '（脚本模型输出）';
}

function resolveText(templateKey, occurrence) {
  const script = state.script;
  const list = Array.isArray(script.rewrite) ? script.rewrite : null;
  if (templateKey.endsWith('.rewrite') && list && list.length > 0) {
    return list[Math.min(occurrence, list.length - 1)] ?? list[list.length - 1];
  }
  // rewrite 输出是纯文本（引擎按 candidate 处理），没有显式脚本时给一个
  // 能通过程序门禁的中性改写文本，避免占位语造成候选与原文语义混乱。
  if (templateKey.endsWith('.rewrite')) {
    return '（脚本改写默认文本）';
  }
  if (templateKey.endsWith('.repair') && typeof script.repair === 'string') {
    return script.repair;
  }
  if (templateKey.endsWith('.review')) {
    const reviews = Array.isArray(script.review) ? script.review : null;
    if (reviews && reviews.length > 0) {
      return reviews[Math.min(occurrence, reviews.length - 1)] ?? reviews[reviews.length - 1];
    }
    return typeof script.review === 'string' ? script.review : defaultScriptFor(templateKey);
  }
  if (templateKey.endsWith('.inspect') && typeof script.inspect === 'string') {
    return script.inspect;
  }
  if (templateKey.endsWith('.plan') && typeof script.plan === 'string') {
    return script.plan;
  }
  return defaultScriptFor(templateKey);
}

function writeEvent(res, event) {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);

  if (req.method === 'POST' && url.pathname === '/__control') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        const patch = body ? JSON.parse(body) : {};
        state.script = { ...state.script, ...(patch.script ?? patch) };
        state.hang = new Set(patch.hang ?? []);
        state.fail = new Set(patch.fail ?? []);
        state.hangAfterNth = patch.hangAfterNth ?? {};
        state.failAfterNth = patch.failAfterNth ?? {};
        sendJson(res, 200, { ok: true });
      } catch (error) {
        sendJson(res, 400, { ok: false, message: String(error) });
      }
    });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/__calls') {
    sendJson(res, 200, { calls: state.calls });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/__reset') {
    state.script = {};
    state.hang = new Set();
    state.fail = new Set();
    state.hangAfterNth = {};
    state.failAfterNth = {};
    state.calls = [];
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/generate') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      let payload = {};
      try {
        payload = body ? JSON.parse(body) : {};
      } catch {
        payload = {};
      }
      const templateKey = String(payload.templateKey ?? '');
      const occurrence = state.calls.filter((item) => item.templateKey === templateKey).length;
      state.calls.push({
        templateKey,
        promptChars: String(payload.prompt ?? '').length,
        at: Date.now(),
      });

      const hangAfter = Number(state.hangAfterNth?.[templateKey] ?? -1);
      const shouldHang = state.hang.has(templateKey) || (hangAfter >= 0 && occurrence >= hangAfter);
      if (shouldHang) {
        // 挂起到客户端断开：用于取消 / 重启场景
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
        writeEvent(res, { event: 'start', traceId: 'fake-hang' });
        req.socket.setTimeout(0);
        res.on('close', () => res.end());
        return;
      }

      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });

      const failAfter = Number(state.failAfterNth?.[templateKey] ?? -1);
      if (state.fail.has(templateKey) || (failAfter >= 0 && occurrence >= failAfter)) {
        writeEvent(res, { event: 'start', traceId: 'fake-fail' });
        writeEvent(res, { event: 'error', data: '脚本模型上游失败' });
        res.end();
        return;
      }

      const text = resolveText(templateKey, occurrence);
      writeEvent(res, { event: 'start', traceId: `fake-${Date.now().toString(36)}` });
      // 分段下发，让前端确实看到流式进度
      const step = Math.max(1, Math.ceil(text.length / 4));
      for (let i = 0; i < text.length; i += step) {
        writeEvent(res, { event: 'content', data: text.slice(i, i + step) });
      }
      writeEvent(res, { event: 'end', completed: true, finishReason: 'stop' });
      res.end();
    });
    return;
  }

  // 其余编排器接口返回最小可用响应，避免真实 API 的旁支调用失败干扰主闭环
  sendJson(res, 200, { ok: true });
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`fake-orchestrator listening on http://127.0.0.1:${port}\n`);
});
