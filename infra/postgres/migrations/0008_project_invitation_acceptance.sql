\set ON_ERROR_STOP on
BEGIN;

ALTER TABLE app.project_invitation
  ADD COLUMN accepted_user_id uuid REFERENCES app.user_account(id) ON DELETE RESTRICT,
  ADD CONSTRAINT project_invitation_acceptance_pair CHECK (
    (accepted_at IS NULL AND accepted_user_id IS NULL)
    OR (accepted_at IS NOT NULL AND accepted_user_id IS NOT NULL)
  );

CREATE UNIQUE INDEX project_invitation_pending_email_unique
  ON app.project_invitation (project_id, lower(email))
  WHERE accepted_at IS NULL;

CREATE FUNCTION app_private.accept_project_invitation(target_token_hash text, verified_email text)
RETURNS TABLE(project_id uuid, user_id uuid)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = app, app_private, pg_catalog
AS $$
DECLARE
  invite app.project_invitation%ROWTYPE;
  v_accepted_user_id uuid;
  user_is_active boolean;
BEGIN
  SELECT * INTO invite
  FROM app.project_invitation
  WHERE token_hash = target_token_hash
    AND lower(email) = lower(trim(verified_email))
    AND accepted_at IS NULL
    AND expires_at > now()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation is invalid or expired' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO app.user_account (email, display_name)
  VALUES (lower(trim(verified_email)), split_part(lower(trim(verified_email)), '@', 1))
  ON CONFLICT (lower(email)) DO NOTHING
  RETURNING id INTO v_accepted_user_id;

  IF v_accepted_user_id IS NULL THEN
    SELECT id, active INTO v_accepted_user_id, user_is_active
    FROM app.user_account
    WHERE lower(email) = lower(trim(verified_email));
    IF NOT FOUND OR NOT user_is_active THEN
      RAISE EXCEPTION 'Application account is inactive' USING ERRCODE = '42501';
    END IF;
  END IF;

  INSERT INTO app.project_membership (project_id, user_id, role)
  VALUES (invite.project_id, v_accepted_user_id, 'guest')
  ON CONFLICT (project_id, user_id) DO NOTHING;

  UPDATE app.project_invitation AS invitation
  SET accepted_at = now(), accepted_user_id = v_accepted_user_id
  WHERE id = invite.id;

  RETURN QUERY SELECT invite.project_id, v_accepted_user_id;
END;
$$;

REVOKE ALL ON FUNCTION app_private.accept_project_invitation(text, text) FROM PUBLIC;

COMMIT;
