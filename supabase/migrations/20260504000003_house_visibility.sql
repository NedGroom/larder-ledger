-- Add public/private visibility and join password to houses
ALTER TABLE houses ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT true;
ALTER TABLE houses ADD COLUMN IF NOT EXISTS join_password TEXT;

-- RPC: find any house by name (bypasses RLS so private houses can be discovered by exact name)
CREATE OR REPLACE FUNCTION find_house_by_name(p_name TEXT)
RETURNS TABLE(id BIGINT, name TEXT, is_public BOOLEAN)
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT id, name, is_public FROM houses WHERE lower(name) = lower(p_name) LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION find_house_by_name(TEXT) TO authenticated;

-- RPC: join a house (handles password check for private houses)
CREATE OR REPLACE FUNCTION join_house(p_house_id BIGINT, p_password TEXT DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_house houses%ROWTYPE;
  v_user_id BIGINT;
BEGIN
  SELECT * INTO v_house FROM houses WHERE id = p_house_id;
  IF NOT FOUND THEN RETURN FALSE; END IF;

  -- Password required for private houses
  IF NOT v_house.is_public THEN
    IF v_house.join_password IS DISTINCT FROM p_password THEN RETURN FALSE; END IF;
  END IF;

  -- Resolve integer user id from auth.uid()
  SELECT id INTO v_user_id FROM users WHERE auth_uid = auth.uid();
  IF NOT FOUND THEN RETURN FALSE; END IF;

  INSERT INTO house_users(house_id, user_id, role)
  VALUES (p_house_id, v_user_id, 'member')
  ON CONFLICT DO NOTHING;

  RETURN TRUE;
END;
$$;
GRANT EXECUTE ON FUNCTION join_house(BIGINT, TEXT) TO authenticated;

