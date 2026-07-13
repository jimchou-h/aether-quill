-- AQ-331: PG 主存扩展列（settings 扩展 / 工作台草稿 / 身份关系）
ALTER TABLE "projects"
  ADD COLUMN IF NOT EXISTS "workbench_structured_json" JSONB,
  ADD COLUMN IF NOT EXISTS "identity_relations_json" JSONB DEFAULT '[]';

ALTER TABLE "project_settings"
  ADD COLUMN IF NOT EXISTS "settings_extensions" JSONB;
