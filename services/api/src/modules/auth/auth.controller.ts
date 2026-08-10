import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Put,
  Request,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request as ExpressRequest } from 'express';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';

interface AuthenticatedRequest extends ExpressRequest {
  user?: { userId: string; email: string; name: string };
}

@Controller('api/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  login(@Body() body: { email: string; password: string }) {
    return this.authService.login(body.email, body.password);
  }

  @Post('refresh')
  refresh(@Body() body: { refreshToken: string }) {
    return this.authService.refreshToken(body.refreshToken);
  }

  @Post('logout')
  logout(@Body() body: { refreshToken: string }) {
    return this.authService.logout(body.refreshToken);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Headers('authorization') auth: string) {
    const token = auth?.replace('Bearer ', '');
    return this.authService.validateToken(token);
  }

  @UseGuards(JwtAuthGuard)
  @Get('generation-preferences')
  getGenerationPreferences(@Request() req: AuthenticatedRequest) {
    const userId = req.user?.userId;
    if (!userId) {
      throw new UnauthorizedException('Unauthorized');
    }
    return this.authService.getGenerationPreferences(userId);
  }

  @UseGuards(JwtAuthGuard)
  @Put('generation-preferences')
  updateGenerationPreferences(
    @Request() req: AuthenticatedRequest,
    @Body() body: unknown
  ) {
    const userId = req.user?.userId;
    if (!userId) {
      throw new UnauthorizedException('Unauthorized');
    }
    return this.authService.updateGenerationPreferences(userId, body);
  }
}
