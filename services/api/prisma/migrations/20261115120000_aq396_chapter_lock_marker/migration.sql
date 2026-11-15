-- AQ-396: author lock marker for chapters (metadata only, never blocks editing)
ALTER TABLE "chapters" ADD COLUMN "is_locked" BOOLEAN NOT NULL DEFAULT false;