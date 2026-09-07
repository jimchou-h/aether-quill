-- AQ-364: persona_card 显式关联人物
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "persona_id" TEXT;
CREATE INDEX IF NOT EXISTS "documents_persona_id_idx" ON "documents"("persona_id");
