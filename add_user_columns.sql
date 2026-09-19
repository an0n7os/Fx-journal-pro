-- Add last_login and auth_provider columns to users table
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'last_login'
  ) THEN
    ALTER TABLE users ADD COLUMN last_login TIMESTAMPTZ;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'auth_provider'
  ) THEN
    ALTER TABLE users ADD COLUMN auth_provider TEXT DEFAULT 'email';
  END IF;
END $$;
