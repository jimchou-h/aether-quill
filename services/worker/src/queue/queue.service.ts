import axios from 'axios';
import { Queue, Worker, Job as BullJob } from 'bullmq';
import IORedis from 'ioredis';
import { IngestionJobData, JobRecord } from '../jobs/types';
import { IngestionProcessor } from '../jobs/ingestion.processor';
import { replaceDocumentVectorsInQdrant } from '../retrieval/qdrant-sync';

interface QueueServiceOptions {
  redisUrl: string;
  apiBaseUrl: string;
}

export class QueueService {
  private readonly connection: IORedis;
  private readonly ingestionQueue: Queue;
  private readonly ingestionWorker: Worker;
  private readonly processor: IngestionProcessor;
  private readonly apiBaseUrl: string;
  private readonly jobStore: Map<string, JobRecord> = new Map();

  constructor(options: QueueServiceOptions) {
    this.apiBaseUrl = options.apiBaseUrl;
    this.connection = new IORedis(options.redisUrl, { maxRetriesPerRequest: null });
    this.processor = new IngestionProcessor({ apiBaseUrl: options.apiBaseUrl });

    this.ingestionQueue = new Queue('ingestion', {
      connection: this.connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 100,
        removeOnFail: 50,
      },
    });

    this.ingestionWorker = new Worker(
      'ingestion',
      async (job: BullJob) => this.processIngestionJob(job),
      {
        connection: this.connection,
        concurrency: 2,
      }
    );

    this.ingestionWorker.on('completed', (job: BullJob) => {
      const record = this.jobStore.get(job.id!);
      if (record) {
        record.status = 'completed';
        record.progress = 100;
        record.completedAt = new Date();
        record.updatedAt = new Date();
      }
    });

    this.ingestionWorker.on('failed', (job: BullJob | undefined, error: Error) => {
      if (!job) return;
      const record = this.jobStore.get(job.id!);
      if (record) {
        record.status = 'failed';
        record.error = error.message;
        record.updatedAt = new Date();
      }
    });
  }

  async createIngestionJob(data: IngestionJobData): Promise<JobRecord> {
    const bullJob = await this.ingestionQueue.add(
      'ingestion',
      data as unknown as Record<string, unknown>,
      {
        jobId: `${data.targetType}-${data.targetId}-${Date.now()}`,
      }
    );

    const record: JobRecord = {
      id: bullJob.id!,
      type: 'ingestion',
      status: 'pending',
      progress: 0,
      data: data as unknown as Record<string, unknown>,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.jobStore.set(record.id, record);
    return record;
  }

  async getJob(jobId: string): Promise<JobRecord | undefined> {
    return this.jobStore.get(jobId);
  }

  async listJobs(status?: string): Promise<JobRecord[]> {
    const jobs = Array.from(this.jobStore.values());
    if (status) {
      return jobs.filter((j) => j.status === status);
    }
    return jobs.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async close(): Promise<void> {
    await this.ingestionWorker.close();
    await this.ingestionQueue.close();
    await this.connection.quit();
  }

  private async processIngestionJob(bullJob: BullJob): Promise<Record<string, unknown>> {
    const data = bullJob.data as unknown as IngestionJobData;

    const record = this.jobStore.get(bullJob.id!);
    if (record) {
      record.status = 'processing';
      record.updatedAt = new Date();
    }

    const updateProgress = async (progress: number) => {
      await bullJob.updateProgress(progress);
      if (record) {
        record.progress = progress;
      }
    };

    if (data.targetType === 'document') {
      try {
        const result = await this.processor.processDocument(data.targetId, (progress) => {
          void updateProgress(progress);
        });

        const language = (process.env.DEFAULT_LANGUAGE || 'zh').trim() || 'zh';
        await replaceDocumentVectorsInQdrant({
          projectId: result.projectId || data.projectId,
          documentId: result.documentId,
          documentType: 'document',
          versionId: result.documentVersion,
          docTitle: result.documentTitle,
          language,
          chunks: result.chunks,
        });

        await axios.put(`${this.apiBaseUrl}/api/documents/${data.targetId}/index-result`, {
          status: 'completed',
          chunks: result.chunks,
        });

        return {
          documentId: result.documentId,
          chunkCount: result.chunks.length,
          status: 'completed',
        } as Record<string, unknown>;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : '索引失败';
        await axios
          .put(`${this.apiBaseUrl}/api/documents/${data.targetId}/index-result`, {
            status: 'failed',
            errorMessage,
          })
          .catch(() => undefined);
        throw error;
      }
    }

    if (data.targetType === 'project') {
      return {
        projectId: data.targetId,
        status: 'completed',
        note: 'project-level ingestion dispatched to document worker',
      } as Record<string, unknown>;
    }

    throw new Error(`Unsupported target type: ${data.targetType}`);
  }
}
