export interface User {
  id: string;
  email: string;
  password: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface Session {
  id: string;
  userId: string;
  token: string;
  expiresAt: string;
  createdAt: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: Omit<User, 'password'>;
}

export interface RefreshResponse {
  accessToken: string;
  refreshToken: string;
}
