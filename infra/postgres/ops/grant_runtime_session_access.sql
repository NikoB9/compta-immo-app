\set ON_ERROR_STOP on

-- Runtime grants for the read-only /api/auth/session endpoint.
-- Safe to reapply after restoring a database; the LOGIN role remains separate.
DO $role$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'app_runtime') THEN
    CREATE ROLE app_runtime NOLOGIN;
  END IF;
END
$role$;
ALTER ROLE app_runtime NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOLOGIN;
GRANT USAGE ON SCHEMA app, app_private TO app_runtime;
GRANT SELECT ON app.user_account, app.workspace, app.workspace_membership,
  app.construction_project, app.project_membership TO app_runtime;
GRANT EXECUTE ON FUNCTION app_private.resolve_user_id_for_email(text) TO app_runtime;
GRANT EXECUTE ON FUNCTION app_private.owner_setup_available() TO app_runtime;
GRANT EXECUTE ON FUNCTION app_private.bootstrap_first_owner(text, text, text, text, text, text, text, text, text[]) TO app_runtime;
GRANT EXECUTE ON FUNCTION app_private.owns_workspace(uuid) TO app_runtime;
GRANT EXECUTE ON FUNCTION app_private.is_project_member(uuid) TO app_runtime;
GRANT EXECUTE ON FUNCTION app_private.can_read_document(uuid) TO app_runtime;
GRANT EXECUTE ON FUNCTION app_private.accept_project_invitation(text, text) TO app_runtime;
