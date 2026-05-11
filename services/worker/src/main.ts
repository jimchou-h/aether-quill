import express from 'express';
import { QueueService } from './queue/queue.service';
import { IngestionJobData } from './jobs/types';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3002;
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';

let queueService: QueueService;

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'worker', timestamp: new Date().toISOString() });
});

app.get('/', (_req, res) => {
  res.json({ message: 'Worker Service', version: '1.0.0' });
});

app.get('/api/jobs', async (req, res) => {
  const status = req.query.status as string | undefined;
  const jobs = await queueService.listJobs(status);
  res.json({ jobs, total: jobs.length });
});

app.post('/api/jobs', async (req, res) => {
  const { type, targetType, targetId, projectId, mode } = req.body;

  if (type !== 'ingestion') {
    return res.status(400).json({ error: `Unsupported job type: ${type}` });
  }

  if (!targetType || !targetId) {
    return res.status(400).json({ error: 'targetType and targetId are required' });
  }

  const jobData: IngestionJobData = {
    type: 'ingestion',
    targetType: targetType || 'document',
    targetId,
    projectId: projectId || '',
    mode: mode || 'full',
  };

  const job = await queueService.createIngestionJob(jobData);
  res.status(201).json({ job });
});

app.get('/api/jobs/:id', async (req, res) => {
  const job = await queueService.getJob(req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  res.json({ job });
});

async function start(): Promise<void> {
  queueService = new QueueService({
    redisUrl: REDIS_URL,
    apiBaseUrl: API_BASE_URL,
  });

  app.listen(PORT, () => {
    console.log(`Worker service running on http://localhost:${PORT}`);
    console.log(`Redis: ${REDIS_URL}`);
  });
}

start().catch((error) => {
  console.error('Failed to start worker service:', error);
  process.exit(1);
});
