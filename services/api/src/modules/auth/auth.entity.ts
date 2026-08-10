import type { UserGenerationPreferences } from '@aether-quill/config';

export interface User {
  id: string;
  email: string;
  password: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  /** 用户全局生成偏好（已规范化）；未设置时为 undefined */
  generationPreferences?: UserGenerationPreferences;
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
