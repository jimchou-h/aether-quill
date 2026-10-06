-- AQ-376 EventCard table
CREATE TABLE IF NOT EXISTS "event_cards" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "chapter_no" INTEGER NOT NULL,
  "beat" TEXT NOT NULL,
  "entities" JSONB NOT NULL,
  "kind" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "evidence" TEXT NOT NULL DEFAULT '',
  "source" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "event_cards_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "event_cards_project_id_idx" ON "event_cards"("project_id");
CREATE INDEX IF NOT EXISTS "event_cards_project_chapter_idx" ON "event_cards"("project_id", "chapter_no");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'event_cards_project_id_fkey'
  ) THEN
    ALTER TABLE "event_cards"
      ADD CONSTRAINT "event_cards_project_id_fkey"
      FOREIGN KEY ("project_id") REFERENCES "projects"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
