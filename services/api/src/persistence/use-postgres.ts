/**
 * 当设置了有效的 `DATABASE_URL` 时，API 运行时对项目 / 文档 / 模板 / 用户做 PG 持久化，
 * 并仍写入 `data/*.json` 作为本地镜像（便于排障与回滚）。
 */
export function usePostgresPersistence(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}
