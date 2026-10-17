-- AQ-380 ChapterRefinementRun table
CREATE TABLE IF NOT EXISTS "chapter_refinement_runs" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "chapter_no" INTEGER NOT NULL,
  "creator_id" TEXT NOT NULL,
  "client_request_id" TEXT NOT NULL,
  "payload_hash" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "phase" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "attempt_id" TEXT,
  "pause_reason" TEXT,
  "resumable" BOOLEAN NOT NULL DEFAULT false,
  "base_updated_at" TIMESTAMP(3) NOT NULL,
  "base_hash" TEXT NOT NULL,
  "rewrite_policy" TEXT NOT NULL,
  "snapshot_json" JSONB NOT NULL,
  "checkpoint_json" JSONB NOT NULL,
  "tombstone" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "chapter_refinement_runs_pkey" PRIMARY KEY ("id")
);

-- 幂等键：同一创建者同一 clientRequestId 只允许一个 run
CREATE UNIQUE INDEX IF NOT EXISTS "chapter_refinement_runs_creator_client_uidx"
  ON "chapter_refinement_runs"("creator_id", "client_request_id");

-- 同作者同章单活动 run：仅对 queued/running 生效
CREATE UNIQUE INDEX IF NOT EXISTS "chapter_refinement_runs_active_uidx"
  ON "chapter_refinement_runs"("project_id", "chapter_no", "creator_id")
  WHERE "status" IN ('queued', 'running');

CREATE INDEX IF NOT EXISTS "chapter_refinement_runs_proj_chap_creator_idx"
  ON "chapter_refinement_runs"("project_id", "chapter_no", "creator_id");

CREATE INDEX IF NOT EXISTS "chapter_refinement_runs_status_idx"
  ON "chapter_refinement_runs"("status");

CREATE INDEX IF NOT EXISTS "chapter_refinement_runs_expires_at_idx"
  ON "chapter_refinement_runs"("expires_at");
