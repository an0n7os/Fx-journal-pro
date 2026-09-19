-- ============================================================
-- MIGRATION: Add exit_time column to the trades table
-- Run this in your Supabase SQL Editor
-- ============================================================

ALTER TABLE trades
  ADD COLUMN IF NOT EXISTS exit_time TIMESTAMPTZ;
