import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { ChapterAutoLoopService } from './chapter-auto-loop.service';
import type { ProjectsService } from './projects.service';
import type { TaskPromptsService } from '../task-prompts/task-prompts.service';

function makeService(chapterContent: string): ChapterAutoLoopService {
  const projectsStub = {
    getSettings: () => ({}),
    getChapterRecordForPipeline: () => ({
      title: '第一章',
      content: chapterContent,
      summary: '',
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    }),
  } as unknown as ProjectsService;
  const taskPromptsStub = {} as unknown as TaskPromptsService;
  return new ChapterAutoLoopService(projectsStub, taskPromptsStub);
}

const noopCallbacks = {
  onStart: () => {},
  onEngineEvent: () => {},
  onEnd: () => {},
  onError: () => {},
};

test('resume:true 无可续跑会话时拒绝（400 语义），不静默全新开始', async () => {
  const service = makeService('雨下了一整夜，屋檐还在滴水。'.repeat(10));
  await assert.rejects(
    () =>
      service.runStream(
        'proj-auto-loop-resume-reject',
        1,
        { instruction: '收紧节奏', resume: true },
        'user-resume-reject',
        noopCallbacks,
        () => false
      ),
    (error: unknown) =>
      error instanceof BadRequestException &&
      String((error as BadRequestException).message).includes('续跑')
  );
});
