import express from 'express';
import { VectorStore } from './retrieval/vector-store';
import { Reranker } from './retrieval/reranker';
import { ChunkWithEmbedding } from './retrieval/types';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3001;
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';

const vectorStore = new VectorStore(API_BASE_URL);
const reranker = new Reranker();

interface ContextChapter {
  chapterNo: number;
  title: string;
  summary: string;
}

interface ProjectContext {
  systemPromptText: string;
  personaProfile: string;
  outlineSummary: string;
  chapters: ContextChapter[];
  updatedAt: string;
}

const projectContextStore = new Map<string, ProjectContext>();

function getOrCreateContext(projectId: string) {
  if (!projectContextStore.has(projectId)) {
    projectContextStore.set(projectId, {
      systemPromptText: '你是一位专业的小说写作助手，请保持设定一致与剧情连贯。',
      personaProfile: '未配置人物设定',
      outlineSummary: '',
      chapters: [],
      updatedAt: new Date().toISOString(),
    });
  }
  return projectContextStore.get(projectId)!;
}

function keywordScore(query: string, text: string) {
  const words = query
    .trim()
    .split(/\s+/)
    .map((item) => item.toLowerCase())
    .filter(Boolean);
  if (words.length === 0) {
    return 0;
  }

  const loweredText = text.toLowerCase();
  return words.reduce((score, word) => score + (loweredText.includes(word) ? 1 : 0), 0);
}

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'rag-orchestrator', timestamp: new Date().toISOString() });
});

app.get('/', (_req, res) => {
  res.json({ message: 'RAG Orchestrator Service', version: '1.0.0' });
});

app.get('/api/projects/:projectId/context', (req, res) => {
  const projectId = req.params.projectId;
  const context = getOrCreateContext(projectId);
  res.json(context);
});

app.post('/api/projects/:projectId/context', (req, res) => {
  const projectId = req.params.projectId;
  const context = getOrCreateContext(projectId);
  const payload = req.body as Partial<ProjectContext>;

  if (typeof payload.systemPromptText === 'string') {
    context.systemPromptText = payload.systemPromptText;
  }
  if (typeof payload.personaProfile === 'string') {
    context.personaProfile = payload.personaProfile;
  }
  if (typeof payload.outlineSummary === 'string') {
    context.outlineSummary = payload.outlineSummary;
  }
  if (Array.isArray(payload.chapters)) {
    context.chapters = payload.chapters;
  }

  context.updatedAt = new Date().toISOString();
  res.json(context);
});

app.post('/api/retrieve', async (req, res) => {
  const { query, projectId, topK = 30, minScore = 0 } = req.body;

  if (!query || !projectId) {
    return res.status(400).json({ error: 'query and projectId are required' });
  }

  try {
    const chunks = await vectorStore.retrieve({ query, projectId, topK, minScore });

    res.json({
      chunks,
      query,
      projectId,
      topK,
      totalRetrieved: chunks.length,
    });
  } catch (error) {
    console.error('Retrieval failed:', error);
    const context = getOrCreateContext(projectId);
    const ranked = context.chapters
      .map((chapter) => ({
        ...chapter,
        score: keywordScore(query, `${chapter.title} ${chapter.summary}`),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    res.json({
      chunks: ranked,
      query,
      projectId,
      topK,
      totalRetrieved: ranked.length,
      fallback: true,
    });
  }
});

app.post('/api/rerank', async (req, res) => {
  const { query, chunks, topN = 10 } = req.body;

  if (!query || !chunks) {
    return res.status(400).json({ error: 'query and chunks are required' });
  }

  const typedChunks: ChunkWithEmbedding[] = chunks.map((c: Partial<ChunkWithEmbedding>) => ({
    id: c.id || '',
    documentId: c.documentId || '',
    content: c.content || '',
    embedding: c.embedding || [],
    metadata: c.metadata || {},
    score: c.score,
  }));

  const rerankedChunks = reranker.rerank(query, typedChunks, topN);

  res.json({
    rerankedChunks,
    query,
    topN,
  });
});

app.post('/api/search', async (req, res) => {
  const { query, projectId, topK = 30, topN = 10, minScore = 0 } = req.body;

  if (!query || !projectId) {
    return res.status(400).json({ error: 'query and projectId are required' });
  }

  try {
    const retrieved = await vectorStore.retrieve({ query, projectId, topK, minScore });
    const reranked = reranker.rerank(query, retrieved, topN);

    res.json({
      results: reranked,
      query,
      projectId,
      topK,
      topN,
      totalRetrieved: retrieved.length,
    });
  } catch (error) {
    console.error('Search failed:', error);
    const context = getOrCreateContext(projectId);
    const ranked = context.chapters
      .map((chapter) => ({
        id: `chapter-${chapter.chapterNo}`,
        documentId: projectId,
        content: `${chapter.title}\n${chapter.summary}`,
        embedding: [] as number[],
        metadata: { chapterNo: chapter.chapterNo, title: chapter.title },
        score: keywordScore(query, `${chapter.title} ${chapter.summary}`),
      }))
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, topN);

    res.json({
      results: ranked,
      query,
      projectId,
      topK,
      topN,
      totalRetrieved: ranked.length,
      fallback: true,
    });
  }
});

app.post('/api/generate', async (req, res) => {
  const {
    projectId,
    task = {},
    citations = [],
  }: {
    projectId: string;
    task: {
      chapterNo?: number;
      goal?: string;
      pov?: string;
      mustInclude?: string[];
      avoid?: string[];
      targetWords?: number;
    };
    citations?: Array<{ sourceId: string; snippet: string }>;
  } = req.body;

  const context = getOrCreateContext(projectId);
  const chapterNo = Number(task.chapterNo || 1);

  res.json({
    draftText: [
      `第${chapterNo}章（编排草稿）`,
      '',
      `写作目标：${task.goal || '推进主线并保持人物一致性'}`,
      `叙事视角：${task.pov || '第三人称'}`,
      `系统提示：${context.systemPromptText}`,
      `人物设定：${context.personaProfile}`,
      '',
      '章节正文示例：角色在冲突现场做出关键抉择，并留下下一章悬念。',
    ].join('\n'),
    reasoningBrief:
      '使用项目上下文完成 multi-project 编排：systemPrompt + persona + outline + chapter summaries。',
    citations,
    consistencyNotes: context.outlineSummary
      ? [{ level: 'info', message: '已加载项目大纲与章节摘要。' }]
      : [{ level: 'warning', message: '未检测到大纲总结，请补充后再生成。' }],
    message: 'Generation completed',
  });
});

app.listen(PORT, () => {
  console.log(`RAG Orchestrator service running on http://localhost:${PORT}`);
  console.log(`API Base URL: ${API_BASE_URL}`);
});
