-- ==============================================================================
-- ADD OTP COLUMNS TO USERS TABLE
-- Run this in your Supabase SQL Editor
-- ==============================================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS password TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_otp TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS otp_expires_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS otp_attempts INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS otp_sent_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_otp TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_otp_expires_at TIMESTAMPTZ;
