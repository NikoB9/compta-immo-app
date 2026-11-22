BEGIN;

-- The server calls this only after verifying a Cloudflare Access application
-- JWT. The application role must never be exposed to an untrusted client.
CREATE FUNCTION app_private.resolve_user_id_for_email(target_email text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = app, pg_catalog
AS $$
  SELECT u.id
  FROM user_account u
  WHERE u.active AND lower(u.email) = lower(trim(target_email))
$$;

REVOKE ALL ON FUNCTION app_private.resolve_user_id_for_email(text) FROM PUBLIC;

COMMIT;
