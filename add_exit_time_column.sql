-- ============================================================
-- MIGRATION: Add exit_time column to the trades table
-- Run this in your Supabase SQL Editor
-- ============================================================

ALTER TABLE trades
  ADD COLUMN IF NOT EXISTS exit_time TIMESTAMPTZ;

-- trades.ticket: the broker's own ticket number for an imported trade.
--
-- The app has always stored it — it is the primary key for duplicate
-- detection when a customer re-pastes an MT5 report — but there was no column,
-- so every trades upsert carrying one was rejected whole:
--   "Could not find the 'ticket' column of 'trades' in the schema cache"
-- PostgREST fails the entire batch on an unknown column, so one imported trade
-- with a ticket silently took every other trade in the same save down with it.
ALTER TABLE trades ADD COLUMN IF NOT EXISTS ticket BIGINT;
CREATE INDEX IF NOT EXISTS trades_account_ticket_idx ON trades (account_id, ticket);
