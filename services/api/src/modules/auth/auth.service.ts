import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Injectable, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { usePostgresPersistence } from '../../persistence/use-postgres';
import { PrismaService } from '../../prisma/prisma.service';
import { User, Session, LoginResponse, RefreshResponse } from './auth.entity';

@Injectable()
export class AuthService implements OnModuleInit {
  private users: Map<string, User> = new Map();
  private sessions: Map<string, Session> = new Map();
  private readonly storagePath = join(resolve(process.cwd()), 'data', 'auth-sessions.json');

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService
  ) {
    if (!usePostgresPersistence()) {
      this.initializeMockUser();
    }
  }

  async onModuleInit() {
    this.restoreSessionsFromDisk();
    if (!usePostgresPersistence()) {
      return;
    }
    try {
      let rows = await this.prisma.user.findMany();
      if (rows.length === 0) {
        const hashedPassword = bcrypt.hashSync('password123', 10);
        await this.prisma.user.create({
          data: {
            id: '1',
            email: 'admin@example.com',
            password: hashedPassword,
            name: 'Admin User',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        });
        rows = await this.prisma.user.findMany();
      }
      for (const u of rows) {
        this.users.set(u.id, {
          id: u.id,
          email: u.email,
          password: u.password,
          name: u.name,
          createdAt: u.createdAt.toISOString(),
          updatedAt: u.updatedAt.toISOString(),
        });
      }

      await this.loadSessionsFromDatabase();
    } catch (err) {
      console.error('[persistence] users PG 加载失败，回退到内存种子', err);
      this.initializeMockUser();
    }
  }

  private async loadSessionsFromDatabase() {
    try {
      const now = new Date();
      const dbSessions = await (this.prisma as any).session.findMany({
        where: {
          expiresAt: {
            gte: now,
          },
        },
      });

      for (const dbSession of dbSessions) {
        this.sessions.set(dbSession.token, {
          id: dbSession.id,
          userId: dbSession.userId,
          token: dbSession.token,
          expiresAt: dbSession.expiresAt.toISOString(),
          createdAt: dbSession.createdAt.toISOString(),
        });
      }
      console.log(`[persistence] 已从数据库加载 ${dbSessions.length} 个有效 sessions`);
      this.persistSessions();
    } catch (err) {
      console.error('[persistence] sessions PG 加载失败', err);
    }
  }

  private restoreSessionsFromDisk() {
    if (!existsSync(this.storagePath)) {
      return;
    }
    try {
      const raw = readFileSync(this.storagePath, 'utf8');
      const parsed = JSON.parse(raw) as { sessions?: Session[] };
      const now = Date.now();
      for (const session of parsed.sessions ?? []) {
        if (!session?.token || !session.expiresAt) {
          continue;
        }
        if (new Date(session.expiresAt).getTime() <= now) {
          continue;
        }
        this.sessions.set(session.token, session);
      }
    } catch (err) {
      console.error('[persistence] auth sessions JSON 加载失败', err);
    }
  }

  private initializeMockUser() {
    const hashedPassword = bcrypt.hashSync('password123', 10);
    this.users.set('1', {
      id: '1',
      email: 'admin@example.com',
      password: hashedPassword,
      name: 'Admin User',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  private findUserByEmail(email: string): User | undefined {
    for (const u of this.users.values()) {
      if (u.email === email) {
        return u;
      }
    }
    return undefined;
  }

  async login(email: string, password: string): Promise<LoginResponse> {
    const user = this.findUserByEmail(email);

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const { accessToken, refreshToken } = await this.generateTokens(user);
    await this.createSession(user.id, refreshToken);

    const { password: _pwd, ...userWithoutPassword } = user;
    void _pwd;
    return {
      accessToken,
      refreshToken,
      user: userWithoutPassword,
    };
  }

  async refreshToken(refreshToken: string): Promise<RefreshResponse> {
    const session = this.sessions.get(refreshToken);

    if (!session || new Date(session.expiresAt) < new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const user = this.users.get(session.userId);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    await this.deleteSession(refreshToken);

    const { accessToken, refreshToken: newRefreshToken } = await this.generateTokens(user);
    await this.createSession(user.id, newRefreshToken);

    return {
      accessToken,
      refreshToken: newRefreshToken,
    };
  }

  validateToken(token: string) {
    if (!token) {
      throw new UnauthorizedException('Token is required');
    }

    try {
      const decoded = this.jwtService.verify(token);
      const user = this.users.get(decoded.sub);
      if (!user) {
        throw new UnauthorizedException('Invalid token');
      }
      const { password: _pwd, ...userWithoutPassword } = user;
      void _pwd;
      return userWithoutPassword;
    } catch (error) {
      throw new UnauthorizedException('Invalid token');
    }
  }

  async logout(refreshToken: string): Promise<void> {
    await this.deleteSession(refreshToken);
  }

  private async generateTokens(user: User) {
    const payload = { sub: user.id, email: user.email, name: user.name };

    const accessToken = this.jwtService.sign(payload, {
      expiresIn: '30m',
    });

    const refreshToken = this.jwtService.sign(payload, {
      expiresIn: '7d',
    });

    return { accessToken, refreshToken };
  }

  private async createSession(userId: string, refreshToken: string) {
    const decoded = this.jwtService.decode(refreshToken) as { exp: number };
    const expiresAt = new Date(decoded.exp * 1000);

    const session: Session = {
      id: crypto.randomUUID(),
      userId,
      token: refreshToken,
      expiresAt: expiresAt.toISOString(),
      createdAt: new Date().toISOString(),
    };

    this.sessions.set(refreshToken, session);
    this.persistSessions();

    if (usePostgresPersistence()) {
      try {
        await (this.prisma as any).session.create({
          data: {
            id: session.id,
            userId: session.userId,
            token: session.token,
            expiresAt: expiresAt,
            createdAt: new Date(session.createdAt),
          },
        });
      } catch (err) {
        console.error('[persistence] session 创建失败', err);
      }
    }
  }

  private async deleteSession(refreshToken: string) {
    this.sessions.delete(refreshToken);
    this.persistSessions();

    if (usePostgresPersistence()) {
      try {
        await (this.prisma as any).session.delete({
          where: {
            token: refreshToken,
          },
        });
      } catch (err) {
        console.error('[persistence] session 删除失败', err);
      }
    }
  }

  getSession(refreshToken: string): Session | undefined {
    return this.sessions.get(refreshToken);
  }

  getAllSessions(): Session[] {
    return Array.from(this.sessions.values());
  }

  clearExpiredSessions(): void {
    const now = new Date();
    let changed = false;
    this.sessions.forEach((session, token) => {
      if (new Date(session.expiresAt) < now) {
        this.sessions.delete(token);
        changed = true;
      }
    });
    if (changed) {
      this.persistSessions();
    }
  }

  private persistSessions() {
    const targetDir = dirname(this.storagePath);
    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true });
    }
    const payload = {
      sessions: Array.from(this.sessions.values()).sort((a, b) =>
        a.createdAt.localeCompare(b.createdAt)
      ),
    };
    writeFileSync(this.storagePath, JSON.stringify(payload, null, 2), 'utf8');
  }
}
