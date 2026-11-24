BEGIN;

-- The application may initialize exactly one owner, and only while the
-- database has no users or workspaces. Identity allowlisting is enforced by
-- the server against INITIAL_OWNER_EMAIL before either function is called.
CREATE FUNCTION app_private.owner_setup_available() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT NOT EXISTS (SELECT 1 FROM app.user_account)
     AND NOT EXISTS (SELECT 1 FROM app.workspace)
$$;

CREATE FUNCTION app_private.bootstrap_first_owner(
  owner_email text,
  owner_display_name text,
  workspace_name text,
  building_label text,
  address_line1 text,
  address_line2 text,
  postal_code text,
  locality text,
  unit_refs text[]
) RETURNS TABLE(owner_id uuid, workspace_id uuid)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  new_owner_id uuid;
  new_workspace_id uuid;
  new_building_id uuid;
  normalized_refs text[];
BEGIN
  PERFORM pg_advisory_xact_lock(1819237485, 1);

  IF EXISTS (SELECT 1 FROM app.user_account)
     OR EXISTS (SELECT 1 FROM app.workspace) THEN
    RAISE EXCEPTION 'Initial owner setup is already complete'
      USING ERRCODE = 'P0002';
  END IF;

  IF owner_email IS NULL OR length(trim(owner_email)) NOT BETWEEN 3 AND 320
     OR owner_display_name IS NULL OR length(trim(owner_display_name)) NOT BETWEEN 1 AND 160
     OR workspace_name IS NULL OR length(trim(workspace_name)) NOT BETWEEN 1 AND 160
     OR building_label IS NULL OR length(trim(building_label)) NOT BETWEEN 1 AND 160
     OR address_line1 IS NULL OR length(trim(address_line1)) NOT BETWEEN 1 AND 240
     OR (address_line2 IS NOT NULL AND length(trim(address_line2)) > 240)
     OR postal_code IS NULL OR length(trim(postal_code)) NOT BETWEEN 1 AND 24
     OR locality IS NULL OR length(trim(locality)) NOT BETWEEN 1 AND 120
     OR unit_refs IS NULL OR cardinality(unit_refs) <> 3
     OR EXISTS (SELECT 1 FROM unnest(unit_refs) ref WHERE length(trim(ref)) NOT BETWEEN 1 AND 80)
     OR (SELECT count(DISTINCT lower(trim(ref))) FROM unnest(unit_refs) ref) <> 3 THEN
    RAISE EXCEPTION 'Initial owner setup details are invalid'
      USING ERRCODE = '22023';
  END IF;

  normalized_refs := ARRAY(
    SELECT trim(ref) FROM unnest(unit_refs) WITH ORDINALITY AS refs(ref, position)
    ORDER BY position
  );

  INSERT INTO app.user_account (email, display_name)
  VALUES (lower(trim(owner_email)), trim(owner_display_name))
  RETURNING id INTO new_owner_id;

  INSERT INTO app.workspace (name)
  VALUES (trim(workspace_name))
  RETURNING id INTO new_workspace_id;

  INSERT INTO app.workspace_membership (workspace_id, user_id, role)
  VALUES (new_workspace_id, new_owner_id, 'owner');

  INSERT INTO app.building_address (
    workspace_id, label, address_line1, address_line2, postal_code, locality, country_code
  ) VALUES (
    new_workspace_id, trim(building_label), trim(address_line1),
    nullif(trim(address_line2), ''), trim(postal_code), trim(locality), 'FR'
  ) RETURNING id INTO new_building_id;

  INSERT INTO app.unit (workspace_id, building_id, unit_ref)
  SELECT new_workspace_id, new_building_id, ref FROM unnest(normalized_refs) AS refs(ref);

  INSERT INTO app.audit_event (workspace_id, actor_user_id, action, entity_type, entity_id)
  VALUES (new_workspace_id, new_owner_id, 'initial_owner_setup_completed', 'workspace', new_workspace_id);

  RETURN QUERY SELECT new_owner_id, new_workspace_id;
END;
$$;

REVOKE ALL ON FUNCTION app_private.owner_setup_available() FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.bootstrap_first_owner(text, text, text, text, text, text, text, text, text[]) FROM PUBLIC;

DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT EXECUTE ON FUNCTION app_private.owner_setup_available() TO app_runtime;
    GRANT EXECUTE ON FUNCTION app_private.bootstrap_first_owner(text, text, text, text, text, text, text, text, text[]) TO app_runtime;
  END IF;
END
$grant$;

COMMIT;
