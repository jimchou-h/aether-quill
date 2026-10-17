/**
 * 项目内编辑对话 HTTP 入口（issue #47）。
 *
 * 路径与 openapi/paths/projects/editor-chat-stream.yaml 一一对应。
 * 只读契约：绝不修改章节、角色卡或项目 Prompt。
 */

import { Body, Controller, HttpCode, Param, Post, Request, Res, UseGuards } from '@nestjs/common';
import { Request as ExpressRequest, Response as ExpressResponse } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { createSseStreamContext } from '../../common/sse-stream.util';
import { EditorChatService } from './editor-chat.service';
import type { EditorChatHistoryMessage } from './editor-chat-prompt.util';

interface AuthenticatedRequest extends ExpressRequest {
  user?: { userId: string; email: string; name: string };
}

interface EditorChatStreamBody {
  question: string;
  history?: EditorChatHistoryMessage[];
  currentChapterNo?: number;
}

@Controller('api/projects')
export class EditorChatController {
  constructor(private readonly editorChatService: EditorChatService) {}

  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  @Post(':id/editor-chat/stream')
  async stream(
    @Param('id') id: string,
    @Body() body: EditorChatStreamBody,
    @Request() req: AuthenticatedRequest,
    @Res() res: ExpressResponse
  ): Promise<void> {
    const userId = req.user?.userId ?? '';
    const input = {
      projectId: id,
      userId,
      question: body?.question ?? '',
      history: Array.isArray(body?.history) ? body.history : undefined,
      currentChapterNo: body?.currentChapterNo,
    };
    // SSE 头写出后无法再改 HTTP 状态码：越权/缺章必须在建流前抛出。
    this.editorChatService.validate(input);

    const sse = createSseStreamContext(req, res);
    try {
      await this.editorChatService.streamChat({ ...input, sse });
    } finally {
      sse.end();
    }
  }
}
