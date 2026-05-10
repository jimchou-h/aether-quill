import { Injectable } from '@nestjs/common';

@Injectable()
export class AuthService {
  login(email: string, password: string) {
    return {
      accessToken: 'mock-jwt-token',
      user: { id: '1', email, name: 'User' }
    };
  }

  validateToken(token: string) {
    return { id: '1', email: 'user@example.com', name: 'User' };
  }
}
