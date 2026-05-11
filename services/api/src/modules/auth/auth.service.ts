import { Injectable } from '@nestjs/common';

@Injectable()
export class AuthService {
  login(email: string, password: string) {
    // MVP mock auth: keep signature aligned with real auth flow.
    if (!password) {
      throw new Error('password is required');
    }
    return {
      accessToken: 'mock-jwt-token',
      user: { id: '1', email, name: 'User' },
    };
  }

  validateToken(token: string) {
    if (!token) {
      throw new Error('token is required');
    }
    return { id: '1', email: 'user@example.com', name: 'User' };
  }
}
