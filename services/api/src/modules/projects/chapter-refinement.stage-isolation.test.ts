/**
 * B5 / R12（R1 修复）：项目写作指导隔离必须走**真实入口**验证。
 *
 * 链路：真实 `OrchestratorRefinementGateway` → 隔离启动的真实 orchestrator HTTP 服务
 * → 本机假 provider（捕获最终 messages）。不手工拼 `GenerationContext`、
 * 不手工设置 `omitProjectSystemPrompt`——那只能证明 assembler 在理想 context 下正确，
 * 证明不了生产链路（此前 `main.ts` 的 override 分支会把 omit 无条件重新打开）。
 *
 * 临时子进程使用无真实凭据的独立环境与临时工作目录；无真实项目数据、无真实模型请求。
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, before, describe, it } from 'node:test';
import { OrchestratorRefinementGateway } from './chapter-refinement.gateway';
import { isRefinementWritingStageTemplateKey } from '@aether-quill/config';

const PROJECT_GUIDE_MARK = 'FROZEN_PROJECT_GUIDE_MARK';
const STYLE_SAMPLE_MARK = 'FROZEN_STYLE_MARK';
const PERSONA_MARK = 'FROZEN_PERSONA_MARK';
const KNOWLEDGE_MARK = 'FROZEN_KNOWLEDGE_MARK';

interface Capture {
  messages: Array<{ role: string; content: string }>;
}

// 测试由 `scripts/run-tests.mjs` 在包目录（services/api）下启动，cwd 即包目录
const REPO_ROOT = path.resolve(process.cwd(), '..', '..');
const ORCHESTRATOR_ROOT = path.join(REPO_ROOT, 'services', 'rag-orchestrator');

let provider: http.Server;
let child: ChildProcess;
let orchestratorUrl = '';
let captures: Capture[] = [];

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port));
  });
}

async function reservePort(): Promise<number> {
  const server = http.createServer();
  const port = await listen(server);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function callStage(
  phase: string,
  options: { withProjectOverride?: boolean } = {}
): Promise<{ system: string; user: string }> {
  const gateway = new OrchestratorRefinementGateway(() => orchestratorUrl);
  const templateKey = `chapter.refinement.${phase}`;
  const result = await gateway.generate({
    projectId: 'stage-isolation-audit',
    chapterNo: 1,
    templateKey,
    systemPromptText: `TASK_CONTRACT_${phase}`,
    ...(options.withProjectOverride ? { projectSystemPromptText: PROJECT_GUIDE_MARK } : {}),
    prompt: `NEUTRAL_TASK_${phase}`,
    maxTokens: 256,
    signal: AbortSignal.timeout(30_000),
    modelRoute: {
      tier: isRefinementWritingStageTemplateKey(templateKey) ? 'writing' : 'utility',
      provider: 'deepseek',
      model: 'deepseek-chat',
      temperature: 0.3,
    },
    frozenReferenceMaterials: {
      materials: [],
      promptText: '',
      personaText: PERSONA_MARK,
      knowledgeText: KNOWLEDGE_MARK,
      styleSampleBlock: STYLE_SAMPLE_MARK,
      frozenAt: '2026-10-07T00:00:00.000Z',
    },
  });
  assert.equal(result.ok, true, `阶段 ${phase} 调用失败：${JSON.stringify(result)}`);
  const messages = captures.at(-1)?.messages ?? [];
  return {
    system: messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n'),
    user: messages
      .filter((message) => message.role === 'user')
      .map((message) => message.content)
      .join('\n'),
  };
}

describe('B5 阶段隔离：真实网关 → 真实 orchestrator → 假 provider 的最终消息', () => {
  before(async () => {
    captures = [];
    provider = http.createServer((req, res) => {
      let text = '';
      req.on('data', (chunk) => {
        text += chunk;
      });
      req.on('end', () => {
        try {
          captures.push(JSON.parse(text) as Capture);
        } catch {
          captures.push({ messages: [] });
        }
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write(
          `data: ${JSON.stringify({ choices: [{ delta: { content: 'NEUTRAL_RESULT' }, finish_reason: null }] })}\n\n`
        );
        res.write(
          `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`
        );
        res.end('data: [DONE]\n\n');
      });
    });
    const providerPort = await listen(provider);
    const orchestratorPort = await reservePort();
    orchestratorUrl = `http://127.0.0.1:${orchestratorPort}`;

    const cwd = mkdtempSync(path.join(tmpdir(), 'aether-stage-isolation-'));
    const requireOrchestrator = createRequire(path.join(ORCHESTRATOR_ROOT, 'package.json'));
    const env: NodeJS.ProcessEnv = {};
    for (const key of [
      'PATH',
      'Path',
      'SystemRoot',
      'WINDIR',
      'TEMP',
      'TMP',
      'USERPROFILE',
      'APPDATA',
      'LOCALAPPDATA',
    ]) {
      if (process.env[key] !== undefined) {
        env[key] = process.env[key];
      }
    }
    Object.assign(env, {
      NODE_ENV: 'test',
      RAG_ORCHESTRATOR_PORT: String(orchestratorPort),
      DEEPSEEK_API_URL: `http://127.0.0.1:${providerPort}/v1`,
      SILICONFLOW_API_URL: `http://127.0.0.1:${providerPort}/v1`,
      PROVIDER_API_KEY: 'stage-isolation-only',
      QDRANT_URL: `http://127.0.0.1:${providerPort}`,
      EMBEDDING_PROVIDER: 'siliconflow',
      EMBEDDING_MODEL: 'BAAI/bge-m3',
      EMBEDDING_API_KEY: 'stage-isolation-only',
      API_BASE_URL: `http://127.0.0.1:${providerPort}`,
      NO_PROXY: '127.0.0.1,localhost',
    });

    let output = '';
    child = spawn(
      process.execPath,
      [
        '--import',
        pathToFileURL(requireOrchestrator.resolve('tsx')).href,
        path.join(ORCHESTRATOR_ROOT, 'src', 'main.ts'),
      ],
      { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
    );
    child.stdout?.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr?.on('data', (chunk) => {
      output += chunk;
    });

    for (let attempt = 0; attempt < 120; attempt += 1) {
      if (child.exitCode !== null) {
        throw new Error(`orchestrator 退出 ${child.exitCode}：${output.slice(-2000)}`);
      }
      try {
        const response = await fetch(
          `${orchestratorUrl}/api/projects/stage-isolation-audit/context`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ systemPromptText: PROJECT_GUIDE_MARK, chapters: [] }),
            signal: AbortSignal.timeout(1500),
          }
        );
        if (response.ok) {
          return;
        }
      } catch {
        // 等这个隔离子进程就绪
      }
      if (attempt === 119) {
        throw new Error(`orchestrator 启动超时：${output.slice(-2000)}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  });

  after(async () => {
    child?.kill();
    await new Promise<void>((resolve) => provider?.close(() => resolve()));
  });

  for (const phase of ['inspect', 'plan', 'rewrite', 'review', 'repair'] as const) {
    const writing = phase === 'rewrite' || phase === 'repair';
    it(`${phase}：${writing ? '注入' : '不注入'}冻结项目文风与样本，任务合同与冻结事实仍在`, async () => {
      const { system, user } = await callStage(phase, { withProjectOverride: true });
      assert.match(system, new RegExp(`TASK_CONTRACT_${phase}`), '任务级 system 必须在位');
      assert.match(user, new RegExp(PERSONA_MARK), '冻结人物设定必须在位');
      assert.match(user, new RegExp(KNOWLEDGE_MARK), '冻结知识必须在位');
      if (writing) {
        assert.match(system, new RegExp(PROJECT_GUIDE_MARK), '写作档必须注入冻结项目文风');
        assert.match(user, new RegExp(STYLE_SAMPLE_MARK), '写作档必须注入冻结文风样本');
      } else {
        assert.doesNotMatch(
          system,
          new RegExp(PROJECT_GUIDE_MARK),
          '工具档不得注入项目文风（真实入口）'
        );
        assert.doesNotMatch(user, new RegExp(STYLE_SAMPLE_MARK), '工具档不得注入文风样本');
      }
    });
  }

  it('工具档显式下发 override 也不得把项目文风重新打开', async () => {
    const { system } = await callStage('inspect', { withProjectOverride: true });
    assert.doesNotMatch(system, new RegExp(PROJECT_GUIDE_MARK));
  });
});
