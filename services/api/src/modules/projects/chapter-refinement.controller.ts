/**
 * 章节精修编排 HTTP 入口（AQ-380）。
 *
 * 与旧 `optimize/*` 入口并列，不改变旧链路行为；最终应用仍复用旧 `optimize/apply`。
 * 路径与 openapi/paths/projects/chapter-refinement-*.yaml 一一对应。
 */

import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Request,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Request as ExpressRequest, Response as ExpressResponse } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { createSseStreamContext } from '../../common/sse-stream.util';
import { ChapterRefinementService } from './chapter-refinement.service';
import type {
  RefinementCancelInput,
  RefinementCreateInput,
  RefinementDiscardInput,
  RefinementResumeInput,
} from './chapter-refinement.types';

interface AuthenticatedRequest extends ExpressRequest {
  user?: { userId: string; email: string; name: string };
  /** ObservabilityInterceptor 注入：请求级 trace id（`x-trace-id` 或自动生成） */
  traceId?: string;
}

@Controller('api/projects')
export class ChapterRefinementController {
  constructor(private readonly chapterRefinementService: ChapterRefinementService) {}

  @UseGuards(JwtAuthGuard)
  @HttpCode(202)
  @Post(':id/knowledge/chapters/:chapterNo/optimize/refinement/runs')
  createRun(
    @Param('id') id: string,
    @Param('chapterNo') chapterNo: string,
    @Body() body: RefinementCreateInput,
    @Request() req: AuthenticatedRequest
  ) {
    return this.chapterRefinementService.createRun(
      id,
      Number(chapterNo),
      body ?? ({} as RefinementCreateInput),
      req.user?.userId ?? '',
      req.traceId
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/knowledge/chapters/:chapterNo/optimize/refinement/runs')
  listRuns(
    @Param('id') id: string,
    @Param('chapterNo') chapterNo: string,
    @Query('limit') limit: string | undefined,
    @Request() req: AuthenticatedRequest
  ) {
    const parsedLimit = limit === undefined || limit === '' ? undefined : Number(limit);
    return this.chapterRefinementService.listRuns(
      id,
      Number(chapterNo),
      req.user?.userId ?? '',
      parsedLimit
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/knowledge/chapters/:chapterNo/optimize/refinement/runs/:runId')
  getRun(
    @Param('id') id: string,
    @Param('chapterNo') chapterNo: string,
    @Param('runId') runId: string,
    @Request() req: AuthenticatedRequest
  ) {
    return this.chapterRefinementService.getRun(
      id,
      Number(chapterNo),
      runId,
      req.user?.userId ?? ''
    );
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  @Post(':id/knowledge/chapters/:chapterNo/optimize/refinement/runs/:runId/cancel')
  cancelRun(
    @Param('id') id: string,
    @Param('chapterNo') chapterNo: string,
    @Param('runId') runId: string,
    @Body() body: RefinementCancelInput,
    @Request() req: AuthenticatedRequest
  ) {
    return this.chapterRefinementService.cancelRun(
      id,
      Number(chapterNo),
      runId,
      req.user?.userId ?? '',
      body
    );
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(202)
  @Post(':id/knowledge/chapters/:chapterNo/optimize/refinement/runs/:runId/resume')
  resumeRun(
    @Param('id') id: string,
    @Param('chapterNo') chapterNo: string,
    @Param('runId') runId: string,
    @Body() body: RefinementResumeInput,
    @Request() req: AuthenticatedRequest
  ) {
    return this.chapterRefinementService.resumeRun(
      id,
      Number(chapterNo),
      runId,
      req.user?.userId ?? '',
      body
    );
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  @Post(':id/knowledge/chapters/:chapterNo/optimize/refinement/runs/:runId/discard')
  discardRun(
    @Param('id') id: string,
    @Param('chapterNo') chapterNo: string,
    @Param('runId') runId: string,
    @Body() body: RefinementDiscardInput,
    @Request() req: AuthenticatedRequest
  ) {
    return this.chapterRefinementService.discardRun(
      id,
      Number(chapterNo),
      runId,
      req.user?.userId ?? '',
      body
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/knowledge/chapters/:chapterNo/optimize/refinement/runs/:runId/events')
  async observeRun(
    @Param('id') id: string,
    @Param('chapterNo') chapterNo: string,
    @Param('runId') runId: string,
    @Request() req: AuthenticatedRequest,
    @Res() res: ExpressResponse
  ) {
    const userId = req.user?.userId ?? '';
    // SSE 头写出后无法再改 HTTP 状态码，鉴权与 404/410 必须在建流之前完成
    await this.chapterRefinementService.getRun(id, Number(chapterNo), runId, userId);

    const sse = createSseStreamContext(req, res);
    try {
      await this.chapterRefinementService.observeRun(id, Number(chapterNo), runId, userId, sse);
    } finally {
      sse.end();
    }
  }
}
