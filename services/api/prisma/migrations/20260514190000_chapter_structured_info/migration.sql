-- AQ-124~126: optional structured info for knowledge title matching
ALTER TABLE "chapters" ADD COLUMN "structured_info" JSONB;
