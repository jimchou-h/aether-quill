/**
 * AQ-357：GS-R 一键评测（默认离线结构化标题匹配）
 *
 * 用法：
 *   pnpm eval:gs-r
 *   pnpm exec tsx scripts/eval/gs-r/run-gs-r.ts --fail-on-threshold
 *
 * 可选 live（依赖本机 orchestrator + 向量，默认不启用）：
 *   GS_R_LIVE=1 RAG_ORCHESTRATOR_URL=http://localhost:3001 pnpm eval:gs-r
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildStructuredKnowledgeEvidence } from '../../../services/rag-orchestrator/src/retrieval/knowledge-retrieval';
import {
  aggregateMetrics,
  evaluateItem,
  formatMetricsReportMarkdown,
  type HitSource,
  type GsRItemResult,
} from './metrics';

interface GoldenDoc {
  id: string;
  title: string;
  content: string;
  docType?: string;
}

interface GoldenItem {
  id: string;
  importance?: string;
  mode?: 'structured' | 'vector';
  chapterNo: number;
  structuredMatchingText?: string;
  expected_document_ids?: string[];
  expected_chunk_ids?: string[];
  expectSkip?: boolean;
  tags?: string[];
}

interface GoldenFile {
  version: string;
  defaultK?: number[];
  corpus: {
    projectId?: string;
    knowledgeDocuments: GoldenDoc[];
  };
  items: GoldenItem[];
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const DEFAULT_GOLDEN = join(__dirname, 'gs-r-v1.json');
const REPORT_DIR = join(__dirname, 'reports');

function parseArgs(argv: string[]) {
  const failOnThreshold = argv.includes('--fail-on-threshold');
  const goldenArg = argv.find((a) => a.startsWith('--golden='));
  const goldenPath = goldenArg ? resolve(ROOT, goldenArg.slice('--golden='.length)) : DEFAULT_GOLDEN;
  return { failOnThreshold, goldenPath };
}

function mapHitSources(result: {
  retrievalSkippedNoStructured?: boolean;
  chunks: Array<{ metadata?: Record<string, unknown> }>;
  fullDocuments?: Array<{ matchedSections?: string[]; evidenceSource?: string }>;
}): HitSource[] {
  if (result.retrievalSkippedNoStructured) {
    return ['skipped'];
  }
  const fromChunks = result.chunks
    .map((c) => String(c.metadata?.evidenceKind ?? ''))
    .filter(Boolean) as HitSource[];
  if (fromChunks.length > 0) {
    return fromChunks;
  }
  // AQ-360：混合合并结果在 fullDocuments 上标注 evidenceSource（title_match/vector/...），优先于旧的
  // matchedSections 兜底（旧路径未接入混合合并时不会设置该字段，逻辑保持向后兼容）
  const fromEvidenceSource = (result.fullDocuments ?? [])
    .map((d) => d.evidenceSource)
    .filter((s): s is HitSource => Boolean(s));
  if (fromEvidenceSource.length > 0) {
    return fromEvidenceSource;
  }
  const fromDocs = (result.fullDocuments ?? []).flatMap((d) =>
    (d.matchedSections ?? []).map((s) => s as HitSource)
  );
  return fromDocs.length > 0 ? fromDocs : (['unknown'] as HitSource[]);
}

function runOfflineStructured(golden: GoldenFile, ks: number[]): GsRItemResult[] {
  const docs = golden.corpus.knowledgeDocuments;
  return golden.items.map((item) => {
    if (item.mode === 'vector') {
      // 向量模式不在默认离线门禁内：记为 skip 失败提示，避免虚高 Recall
      return evaluateItem({
        id: item.id,
        rankedDocumentIds: [],
        hitSources: ['unknown'],
        skipped: true,
        expectedDocumentIds: item.expected_document_ids ?? [],
        expectSkip: true,
        ks,
      });
    }

    const chapterNo = item.chapterNo;
    const matchingText = item.structuredMatchingText ?? '';
    const result = buildStructuredKnowledgeEvidence(chapterNo, {
      chapterNo,
      chapters: [{ chapterNo, structuredMatchingText: matchingText }],
      knowledgeDocuments: docs,
    });

    return evaluateItem({
      id: item.id,
      rankedDocumentIds: result.titleMatchedDocumentIds,
      hitSources: mapHitSources(result),
      skipped: Boolean(result.retrievalSkippedNoStructured),
      expectedDocumentIds: item.expected_document_ids ?? [],
      expectSkip: item.expectSkip,
      ks,
    });
  });
}

async function runLivePreview(golden: GoldenFile, ks: number[]): Promise<GsRItemResult[]> {
  const base = (process.env.RAG_ORCHESTRATOR_URL || 'http://localhost:3001').replace(/\/$/, '');
  const results: GsRItemResult[] = [];

  for (const item of golden.items) {
    if (item.expectSkip) {
      results.push(
        evaluateItem({
          id: item.id,
          rankedDocumentIds: [],
          hitSources: ['skipped'],
          skipped: true,
          expectedDocumentIds: [],
          expectSkip: true,
          ks,
        })
      );
      continue;
    }

    const body = {
      projectId: golden.corpus.projectId || 'gs-r-fixture-project',
      chapterNo: item.chapterNo,
      useStructuredKb: item.mode !== 'vector',
      // AQ-360：live 回归按 golden 样本的 mode 强制单路径，避免默认 hybrid 混入向量噪声导致结果不确定
      retrievalMode: item.mode === 'vector' ? 'vector_only' : 'structured_only',
      prompt: item.structuredMatchingText || item.id,
      projectCtx: {
        outlineSummary: '',
        personaProfile: '',
        chapters: [
          {
            chapterNo: item.chapterNo,
            title: `第${item.chapterNo}章`,
            summary: '',
            structuredMatchingText: item.structuredMatchingText || '',
          },
        ],
        knowledgeDocuments: golden.corpus.knowledgeDocuments,
      },
    };

    const res = await fetch(`${base}/api/preview-retrieval`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`live preview failed for ${item.id}: HTTP ${res.status}`);
    }
    const data = (await res.json()) as {
      items?: Array<{
        id: string;
        pool?: string;
        selected?: boolean;
        meta?: { evidenceSource?: string };
      }>;
    };
    const selectedDocs = (data.items ?? []).filter(
      (row) => row.selected && (row.pool === 'persona_card' || row.pool === 'other_docs')
    );
    const ranked = selectedDocs.map((row) => row.id);
    // AQ-360：优先使用响应中标注的 evidenceSource，未标注时按请求的单路径模式兜底
    const hitSources = selectedDocs
      .map((row) => row.meta?.evidenceSource)
      .filter((s): s is HitSource => Boolean(s));

    results.push(
      evaluateItem({
        id: item.id,
        rankedDocumentIds: ranked,
        hitSources:
          hitSources.length > 0 ? hitSources : [item.mode === 'vector' ? 'vector' : 'title_match'],
        skipped: ranked.length === 0 && !(item.structuredMatchingText || '').trim(),
        expectedDocumentIds: item.expected_document_ids ?? [],
        expectSkip: item.expectSkip,
        ks,
      })
    );
  }

  return results;
}

async function main() {
  const { failOnThreshold, goldenPath } = parseArgs(process.argv.slice(2));
  const live = process.env.GS_R_LIVE === '1' || process.env.GS_R_LIVE === 'true';
  const golden = JSON.parse(readFileSync(goldenPath, 'utf8')) as GoldenFile;
  const ks = golden.defaultK ?? [1, 3, 5, 10, 30];

  if (golden.items.length < 30) {
    throw new Error(`GS-R golden 样本不足 30 条：当前 ${golden.items.length}`);
  }

  const results = live
    ? await runLivePreview(golden, ks)
    : runOfflineStructured(golden, ks);

  const report = aggregateMetrics({
    datasetVersion: golden.version,
    mode: live ? 'live-preview' : 'offline-structured',
    results,
    ks,
  });

  const markdown = formatMetricsReportMarkdown(report);
  mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = report.evaluatedAt.replace(/[:.]/g, '-');
  const outPath = join(REPORT_DIR, `${golden.version}-${stamp}.md`);
  const latestPath = join(REPORT_DIR, 'latest.md');
  writeFileSync(outPath, markdown, 'utf8');
  writeFileSync(latestPath, markdown, 'utf8');
  writeFileSync(join(REPORT_DIR, 'latest.json'), JSON.stringify(report, null, 2), 'utf8');

  console.log(markdown);
  console.log(`报告已写入: ${outPath}`);

  if (failOnThreshold && report.conclusion === 'FAIL') {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
