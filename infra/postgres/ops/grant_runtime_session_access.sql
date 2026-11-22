\set ON_ERROR_STOP on

-- One-time setup for the current read-only /api/auth/session endpoint.
-- Create the LOGIN role separately and grant it membership in app_runtime.
CREATE ROLE app_runtime NOLOGIN;
GRANT USAGE ON SCHEMA app, app_private TO app_runtime;
GRANT SELECT ON app.workspace, app.workspace_membership,
  app.construction_project, app.project_membership TO app_runtime;
GRANT EXECUTE ON FUNCTION app_private.resolve_user_id_for_email(text) TO app_runtime;
GRANT EXECUTE ON FUNCTION app_private.owns_workspace(uuid) TO app_runtime;
GRANT EXECUTE ON FUNCTION app_private.is_project_member(uuid) TO app_runtime;
GRANT EXECUTE ON FUNCTION app_private.can_read_document(uuid) TO app_runtime;
