BEGIN;

DROP FUNCTION IF EXISTS app_private.bootstrap_first_owner(text, text, text, text, text, text, text, text, text[]);

CREATE FUNCTION app_private.bootstrap_first_owner(owner_email text, owner_display_name text, workspace_name text)
RETURNS TABLE(owner_id uuid, workspace_id uuid)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  new_owner_id uuid;
  new_workspace_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(1819237485, 1);

  IF EXISTS (SELECT 1 FROM app.user_account)
     OR EXISTS (SELECT 1 FROM app.workspace) THEN
    RAISE EXCEPTION 'Initial owner setup is already complete'
      USING ERRCODE = 'P0002';
  END IF;

  IF owner_email IS NULL OR length(trim(owner_email)) NOT BETWEEN 3 AND 320
     OR position('@' IN owner_email) < 2
     OR owner_display_name IS NULL OR length(trim(owner_display_name)) NOT BETWEEN 1 AND 160
     OR workspace_name IS NULL OR length(trim(workspace_name)) NOT BETWEEN 1 AND 160 THEN
    RAISE EXCEPTION 'Initial owner setup details are invalid'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO app.user_account (email, display_name)
  VALUES (lower(trim(owner_email)), trim(owner_display_name))
  RETURNING id INTO new_owner_id;

  INSERT INTO app.workspace (name)
  VALUES (trim(workspace_name))
  RETURNING id INTO new_workspace_id;

  INSERT INTO app.workspace_membership (workspace_id, user_id, role)
  VALUES (new_workspace_id, new_owner_id, 'owner');

  INSERT INTO app.audit_event (workspace_id, actor_user_id, action, entity_type, entity_id)
  VALUES (new_workspace_id, new_owner_id, 'initial_owner_setup_completed', 'workspace', new_workspace_id);

  RETURN QUERY SELECT new_owner_id, new_workspace_id;
END;
$$;

REVOKE ALL ON FUNCTION app_private.bootstrap_first_owner(text, text, text) FROM PUBLIC;

DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT EXECUTE ON FUNCTION app_private.bootstrap_first_owner(text, text, text) TO app_runtime;
    GRANT INSERT ON app.building_address, app.unit TO app_runtime;
  END IF;
END
$grant$;

COMMIT;
