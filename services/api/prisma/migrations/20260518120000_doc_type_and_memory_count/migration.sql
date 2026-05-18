ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "doc_type" TEXT NOT NULL DEFAULT 'other';
ALTER TABLE "project_settings" ADD COLUMN IF NOT EXISTS "chapter_summary_memory_count" INTEGER NOT NULL DEFAULT 3;
