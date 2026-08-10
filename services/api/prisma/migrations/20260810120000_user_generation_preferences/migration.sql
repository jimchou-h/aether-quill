-- AlterTable
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "generation_preferences_json" JSONB;
