-- AQ-183: Persona graph fields on personas and relation_events

ALTER TABLE "personas" ADD COLUMN IF NOT EXISTS "relation_event_ids" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "personas" ADD COLUMN IF NOT EXISTS "appeared_chapter_nos" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "personas" ADD COLUMN IF NOT EXISTS "last_appeared_chapter_no" INTEGER;

ALTER TABLE "relation_events" ADD COLUMN IF NOT EXISTS "protagonist_persona_id" TEXT;
ALTER TABLE "relation_events" ADD COLUMN IF NOT EXISTS "counterparty_persona_id" TEXT;
