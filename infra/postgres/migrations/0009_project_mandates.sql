BEGIN;

CREATE TABLE app.project_mandate (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  title text NOT NULL,
  mandate_data jsonb NOT NULL,
  content_sha256 char(64) NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  created_by uuid NOT NULL REFERENCES app.user_account(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, project_id) REFERENCES app.construction_project(workspace_id, id) ON DELETE RESTRICT,
  CHECK (length(trim(title)) BETWEEN 1 AND 200),
  CHECK (jsonb_typeof(mandate_data) = 'object')
);
CREATE INDEX project_mandate_project_date ON app.project_mandate(workspace_id, project_id, created_at DESC);

CREATE TABLE app.project_mandate_signature (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  mandate_id uuid NOT NULL,
  party_role text NOT NULL CHECK (party_role IN ('mandant', 'mandataire')),
  signer_user_id uuid NOT NULL REFERENCES app.user_account(id) ON DELETE RESTRICT,
  signer_email text NOT NULL,
  signer_name text NOT NULL,
  consent_text text NOT NULL,
  content_sha256 char(64) NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  signature_image_document_id uuid,
  signed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (mandate_id, party_role),
  FOREIGN KEY (workspace_id, mandate_id) REFERENCES app.project_mandate(workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, project_id) REFERENCES app.construction_project(workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, signature_image_document_id) REFERENCES app.stored_document(workspace_id, id) ON DELETE RESTRICT,
  CHECK (length(trim(signer_email)) BETWEEN 3 AND 320),
  CHECK (length(trim(signer_name)) BETWEEN 1 AND 200),
  CHECK (length(trim(consent_text)) BETWEEN 20 AND 1000)
);
CREATE INDEX project_mandate_signature_project_date ON app.project_mandate_signature(project_id, signed_at);

CREATE FUNCTION app_private.guard_project_mandate_update() RETURNS trigger
LANGUAGE plpgsql
SET search_path = app, app_private, pg_catalog
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM project_mandate_signature s WHERE s.mandate_id = OLD.id) THEN
    RAISE EXCEPTION 'A mandate cannot be changed after the first signature' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.workspace_id <> OLD.workspace_id OR NEW.project_id <> OLD.project_id
     OR NEW.content_sha256 = OLD.content_sha256 AND NEW.mandate_data <> OLD.mandate_data THEN
    RAISE EXCEPTION 'Mandate content digest must be updated with its content' USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER project_mandate_update_guard
BEFORE UPDATE ON app.project_mandate
FOR EACH ROW EXECUTE FUNCTION app_private.guard_project_mandate_update();

ALTER TABLE app.project_mandate ENABLE ROW LEVEL SECURITY;
CREATE POLICY project_mandate_member_read ON app.project_mandate FOR SELECT USING (
  app_private.owns_workspace(workspace_id) OR app_private.is_project_member(project_id)
);
CREATE POLICY project_mandate_owner_insert ON app.project_mandate FOR INSERT WITH CHECK (
  app_private.owns_workspace(workspace_id) AND created_by = app_private.actor_user_id()
);
CREATE POLICY project_mandate_owner_update ON app.project_mandate FOR UPDATE USING (
  app_private.owns_workspace(workspace_id)
) WITH CHECK (app_private.owns_workspace(workspace_id));

ALTER TABLE app.project_mandate_signature ENABLE ROW LEVEL SECURITY;
CREATE POLICY project_mandate_signature_member_read ON app.project_mandate_signature FOR SELECT USING (
  app_private.owns_workspace(workspace_id) OR app_private.is_project_member(project_id)
);
CREATE POLICY project_mandate_signature_party_insert ON app.project_mandate_signature FOR INSERT WITH CHECK (
  signer_user_id = app_private.actor_user_id()
  AND (app_private.owns_workspace(workspace_id) OR app_private.is_project_member(project_id))
  AND EXISTS (
    SELECT 1 FROM app.project_mandate m
    WHERE m.id = mandate_id AND m.project_id = project_mandate_signature.project_id
      AND m.workspace_id = project_mandate_signature.workspace_id
      AND m.content_sha256 = project_mandate_signature.content_sha256
      AND lower(m.mandate_data #>> ARRAY['parties', party_role, 'email']) = lower(trim(signer_email))
  )
);

GRANT SELECT, INSERT, UPDATE ON app.project_mandate TO app_runtime;
GRANT SELECT, INSERT ON app.project_mandate_signature TO app_runtime;

COMMIT;
