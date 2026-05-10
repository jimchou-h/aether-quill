// @aether-quill/shared-types
// 共享类型定义

export interface User {
  id: string,
  email: string,
  name?: string,
  createdAt: Date,
  updatedAt: Date,
}

export interface Project {
  id: string,
  name: string,
  description?: string,
  createdBy: string,
  createdAt: Date,
  updatedAt: Date,
}
