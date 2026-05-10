import express from 'express';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3002;

interface Job {
  id: string;
  type: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  createdAt: Date;
}

const jobs: Job[] = [];

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'worker', timestamp: new Date().toISOString() });
});

app.get('/', (req, res) => {
  res.json({ message: 'Worker Service', version: '1.0.0' });
});

app.get('/api/jobs', (req, res) => {
  res.json({ jobs, total: jobs.length });
});

app.post('/api/jobs', (req, res) => {
  const { type, data } = req.body;
  const job: Job = {
    id: `job-${Date.now()}`,
    type,
    status: 'pending',
    createdAt: new Date()
  };
  jobs.push(job);
  res.json({ job, message: 'Job created - to be implemented' });
});

app.get('/api/jobs/:id', (req, res) => {
  const job = jobs.find(j => j.id === req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  res.json({ job });
});

app.listen(PORT, () => {
  console.log(`Worker service running on http://localhost:${PORT}`);
});
