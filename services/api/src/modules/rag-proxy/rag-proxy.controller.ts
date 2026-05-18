import {
  BadRequestException,
  Body,
  Controller,
  InternalServerErrorException,
  Post,
  Request,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import axios from 'axios';
import { Request as ExpressRequest } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ProjectsService } from '../projects/projects.service';

interface AuthenticatedRequest extends ExpressRequest {
  user?: { userId: string; email: string; name: string };
}

@Controller('api')
export class RagProxyController {
  constructor(private readonly projectsService: ProjectsService) {}

  @UseGuards(JwtAuthGuard)
  @Post('preview-retrieval')
  async previewRetrieval(
    @Body()
    body: {
      projectId?: string;
      prompt?: string;
      chapterNo?: number;
      useStructuredKb?: boolean;
      projectCtx?: Record<string, unknown>;
      extraContext?: Record<string, unknown>;
    },
    @Request() req: AuthenticatedRequest
  ) {
    const projectId = body.projectId?.trim();
    if (!projectId) {
      throw new BadRequestException('projectId is required');
    }

    const userId = req.user?.userId;
    if (!userId) {
      throw new BadRequestException('未登录');
    }
    this.projectsService.findOne(projectId, userId);

    const ragUrl = process.env.RAG_ORCHESTRATOR_URL || 'http://localhost:3001';
    try {
      const { data } = await axios.post(`${ragUrl}/api/preview-retrieval`, body, {
        timeout: 120000,
      });
      return data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
          throw new ServiceUnavailableException('RAG 编排服务不可用');
        }
        const status = error.response?.status;
        const message =
          typeof error.response?.data === 'object' &&
          error.response?.data &&
          'error' in error.response.data
            ? String((error.response.data as { error: unknown }).error)
            : error.message;
        if (status === 400) {
          throw new BadRequestException(message);
        }
        throw new InternalServerErrorException(message || '检索预览失败');
      }
      throw error;
    }
  }
}
