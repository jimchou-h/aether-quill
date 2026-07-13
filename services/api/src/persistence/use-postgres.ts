/**
 * 当设置了有效的 `DATABASE_URL` 时，API 运行时以 PostgreSQL 为唯一权威存储。
 * 未配置时回退到 `services/api/data/*.json`（本地开发）。
 *
 * 一次性灌库：`pnpm migrate:json-to-pg -- --confirm` 或 `npx tsx scripts/sync-workspace-json-to-pg.ts`
 */
export function usePostgresPersistence(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}
