-- AQ-132~133: 项目设置摘要数与生成温度（PostgreSQL）
ALTER TABLE "project_settings" ADD COLUMN IF NOT EXISTS "chapter_summary_prompt_count" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "project_settings" ADD COLUMN IF NOT EXISTS "generation_temperature" DOUBLE PRECISION NOT NULL DEFAULT 0.7;
