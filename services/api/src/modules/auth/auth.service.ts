import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { User, Session, LoginResponse, RefreshResponse } from './auth.entity';

@Injectable()
export class AuthService {
  private users: Map<string, User> = new Map();
  private sessions: Map<string, Session> = new Map();

  constructor(private readonly jwtService: JwtService) {
    this.initializeMockUser();
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

  async login(email: string, password: string): Promise<LoginResponse> {
    const user = this.users.get('1');

    if (!user || user.email !== email) {
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

    this.sessions.delete(refreshToken);

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
    this.sessions.delete(refreshToken);
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
    const session: Session = {
      id: crypto.randomUUID(),
      userId,
      token: refreshToken,
      expiresAt: new Date(decoded.exp * 1000).toISOString(),
      createdAt: new Date().toISOString(),
    };
    this.sessions.set(refreshToken, session);
  }

  getSession(refreshToken: string): Session | undefined {
    return this.sessions.get(refreshToken);
  }

  getAllSessions(): Session[] {
    return Array.from(this.sessions.values());
  }

  clearExpiredSessions(): void {
    const now = new Date();
    this.sessions.forEach((session, token) => {
      if (new Date(session.expiresAt) < now) {
        this.sessions.delete(token);
      }
    });
  }
}
