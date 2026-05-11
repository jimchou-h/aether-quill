import express from 'express';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3001;

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

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'rag-orchestrator', timestamp: new Date().toISOString() });
});

app.get('/', (req, res) => {
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
  const { query, projectId, topK = 30 } = req.body;
  const context = getOrCreateContext(projectId);
  const ranked = context.chapters
    .map((chapter) => ({
      ...chapter,
      score: keywordScore(query || '', `${chapter.title} ${chapter.summary}`),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  res.json({
    chunks: ranked,
    query,
    projectId,
    topK,
    message: 'Retrieval completed',
  });
});

app.post('/api/rerank', async (req, res) => {
  const { chunks, query, topN = 10 } = req.body;
  const rerankedChunks = (chunks || [])
    .map((chunk: { title?: string; summary?: string; score?: number }) => ({
      ...chunk,
      rerankScore:
        (chunk.score || 0) +
        keywordScore(query || '', `${chunk.title || ''} ${chunk.summary || ''}`),
    }))
    .sort(
      (a: { rerankScore?: number }, b: { rerankScore?: number }) =>
        (b.rerankScore || 0) - (a.rerankScore || 0)
    )
    .slice(0, topN);

  res.json({
    rerankedChunks,
    query,
    topN,
    message: 'Rerank completed',
  });
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
      `章节正文示例：角色在冲突现场做出关键抉择，并留下下一章悬念。`,
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
});
