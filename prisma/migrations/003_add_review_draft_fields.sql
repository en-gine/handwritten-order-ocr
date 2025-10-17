-- Migration: Add draft auto-save fields to ReviewQueue
-- T056a: Support draft auto-save functionality for review workflow

-- Add draft fields for auto-saving review corrections
ALTER TABLE review_queue ADD COLUMN draftCustomerCorrection TEXT;
ALTER TABLE review_queue ADD COLUMN draftItemCorrections TEXT;
ALTER TABLE review_queue ADD COLUMN draftReviewNotes TEXT;
ALTER TABLE review_queue ADD COLUMN lastActivityAt INTEGER;

-- Note: SQLite stores DateTime as INTEGER (Unix timestamp in milliseconds)
-- Prisma will handle conversion between JavaScript Date and SQLite INTEGER
