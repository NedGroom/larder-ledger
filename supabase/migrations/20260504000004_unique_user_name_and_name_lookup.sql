-- Migration: enforce unique names on users table and add a name→email lookup RPC

-- Make name unique so users can sign in with name+password
ALTER TABLE users ADD CONSTRAINT users_name_unique UNIQUE (name);

-- ─────────────────────────────────────────────────────────────────────────────
-- FUNCTION: get_email_by_name(p_name)
-- Returns the email address for a given unique display name.
-- Used by the sign-in flow to allow "name or email" login.
-- SECURITY DEFINER so it can read the users table regardless of RLS.
-- Returns NULL if no matching user is found.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_email_by_name(p_name TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT email FROM users WHERE lower(name) = lower(p_name) LIMIT 1;
$$;

COMMENT ON FUNCTION get_email_by_name(TEXT) IS
  'Resolves a unique display name to the associated email address. '
  'Used to support name+password sign-in as an alternative to email+password.';

