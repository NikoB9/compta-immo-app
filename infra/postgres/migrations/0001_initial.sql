BEGIN;

CREATE SCHEMA app;
CREATE SCHEMA app_private;

CREATE TABLE app.user_account (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  display_name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_email_nonempty CHECK (length(trim(email)) BETWEEN 3 AND 320)
);
CREATE UNIQUE INDEX user_email_lower_unique ON app.user_account (lower(email));

CREATE TABLE app.workspace (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspace_name_nonempty CHECK (length(trim(name)) > 0)
);

CREATE TABLE app.workspace_membership (
  workspace_id uuid NOT NULL REFERENCES app.workspace(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES app.user_account(id) ON DELETE RESTRICT,
  role text NOT NULL CHECK (role IN ('owner', 'administrator')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);
CREATE UNIQUE INDEX workspace_one_owner ON app.workspace_membership(workspace_id) WHERE role = 'owner';

CREATE TABLE app.building_address (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES app.workspace(id) ON DELETE RESTRICT,
  label text NOT NULL,
  address_line1 text NOT NULL,
  address_line2 text,
  postal_code text NOT NULL,
  locality text NOT NULL,
  country_code char(2) NOT NULL DEFAULT 'FR',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  CHECK (length(trim(label)) > 0),
  CHECK (length(trim(address_line1)) > 0),
  CHECK (length(trim(postal_code)) > 0),
  CHECK (length(trim(locality)) > 0)
);

CREATE TABLE app.unit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  building_id uuid NOT NULL,
  unit_ref text NOT NULL,
  description text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (building_id, unit_ref),
  UNIQUE (workspace_id, building_id, id),
  FOREIGN KEY (workspace_id, building_id) REFERENCES app.building_address(workspace_id, id) ON DELETE RESTRICT,
  CHECK (length(trim(unit_ref)) > 0)
);

CREATE TABLE app.tax_profile (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  building_id uuid NOT NULL,
  unit_id uuid,
  effective_year smallint NOT NULL CHECK (effective_year BETWEEN 1900 AND 2200),
  rental_type text NOT NULL CHECK (rental_type IN ('unfurnished', 'furnished', 'other')),
  tax_regime text NOT NULL,
  status text NOT NULL DEFAULT 'needs_review' CHECK (status IN ('draft', 'needs_review', 'confirmed')),
  confirmed_by uuid REFERENCES app.user_account(id) ON DELETE RESTRICT,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, building_id) REFERENCES app.building_address(workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, building_id, unit_id) REFERENCES app.unit(workspace_id, building_id, id) ON DELETE RESTRICT,
  CHECK ((status = 'confirmed') = (confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL))
);
CREATE UNIQUE INDEX tax_profile_building_year ON app.tax_profile(workspace_id, building_id, effective_year) WHERE unit_id IS NULL;
CREATE UNIQUE INDEX tax_profile_unit_year ON app.tax_profile(workspace_id, unit_id, effective_year) WHERE unit_id IS NOT NULL;

CREATE TABLE app.category (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES app.workspace(id) ON DELETE RESTRICT,
  code text NOT NULL,
  label text NOT NULL,
  entry_type text NOT NULL CHECK (entry_type IN ('income', 'expense')),
  active boolean NOT NULL DEFAULT true,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, code),
  UNIQUE (workspace_id, id, entry_type),
  CHECK (length(trim(code)) > 0 AND length(trim(label)) > 0)
);

CREATE TABLE app.financial_entry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  building_id uuid NOT NULL,
  unit_id uuid,
  category_id uuid,
  tax_year smallint NOT NULL CHECK (tax_year BETWEEN 1900 AND 2200),
  occurred_on date NOT NULL,
  entry_type text NOT NULL CHECK (entry_type IN ('income', 'expense')),
  description text NOT NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  administrative_amount_cents bigint NOT NULL DEFAULT 0 CHECK (administrative_amount_cents >= 0),
  internal_only_cents bigint NOT NULL DEFAULT 0 CHECK (internal_only_cents >= 0),
  currency char(3) NOT NULL DEFAULT 'EUR' CHECK (currency = 'EUR'),
  review_status text NOT NULL DEFAULT 'needs_review' CHECK (review_status IN ('draft', 'needs_review', 'confirmed', 'excluded')),
  created_by uuid NOT NULL REFERENCES app.user_account(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, building_id) REFERENCES app.building_address(workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, building_id, unit_id) REFERENCES app.unit(workspace_id, building_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, category_id, entry_type) REFERENCES app.category(workspace_id, id, entry_type) ON DELETE RESTRICT,
  CHECK (amount_cents = administrative_amount_cents + internal_only_cents),
  CHECK (length(trim(description)) > 0)
);
CREATE INDEX financial_entry_year_date ON app.financial_entry(workspace_id, tax_year, occurred_on);

CREATE TABLE app.stored_document (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES app.workspace(id) ON DELETE RESTRICT,
  object_key text NOT NULL,
  original_filename text NOT NULL,
  media_type text NOT NULL,
  byte_size bigint NOT NULL CHECK (byte_size > 0),
  sha256 char(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  uploaded_by uuid NOT NULL REFERENCES app.user_account(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, object_key),
  CHECK (length(trim(original_filename)) > 0)
);

CREATE TABLE app.entry_document (
  workspace_id uuid NOT NULL,
  entry_id uuid NOT NULL,
  document_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entry_id, document_id),
  FOREIGN KEY (workspace_id, entry_id) REFERENCES app.financial_entry(workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, document_id) REFERENCES app.stored_document(workspace_id, id) ON DELETE RESTRICT
);

CREATE TABLE app.supplier_invoice (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  entry_id uuid,
  supplier_name text NOT NULL,
  invoice_number text,
  invoice_date date,
  invoice_total_cents bigint NOT NULL CHECK (invoice_total_cents > 0),
  currency char(3) NOT NULL DEFAULT 'EUR' CHECK (currency = 'EUR'),
  invoice_document_id uuid NOT NULL,
  extraction_status text NOT NULL DEFAULT 'needs_review' CHECK (extraction_status IN ('needs_review', 'confirmed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, entry_id) REFERENCES app.financial_entry(workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, invoice_document_id) REFERENCES app.stored_document(workspace_id, id) ON DELETE RESTRICT,
  CHECK (length(trim(supplier_name)) > 0)
);

CREATE TABLE app.invoice_payment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  paid_on date NOT NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  paid_by text NOT NULL CHECK (paid_by IN ('owner', 'mandatary', 'other')),
  proof_document_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, invoice_id) REFERENCES app.supplier_invoice(workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, proof_document_id) REFERENCES app.stored_document(workspace_id, id) ON DELETE RESTRICT
);
CREATE INDEX invoice_payment_invoice_date ON app.invoice_payment(workspace_id, invoice_id, paid_on);

CREATE FUNCTION app_private.check_invoice_payment_total() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = app, pg_catalog
AS $$
DECLARE
  invoice_total bigint;
  other_payments numeric;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  SELECT i.invoice_total_cents INTO invoice_total
  FROM supplier_invoice i
  WHERE i.workspace_id = NEW.workspace_id AND i.id = NEW.invoice_id
  FOR UPDATE;

  SELECT COALESCE(sum(p.amount_cents), 0) INTO other_payments
  FROM invoice_payment p
  WHERE p.workspace_id = NEW.workspace_id
    AND p.invoice_id = NEW.invoice_id
    AND p.id IS DISTINCT FROM NEW.id;

  IF other_payments + NEW.amount_cents > invoice_total THEN
    RAISE EXCEPTION 'Invoice payment allocations exceed invoice total'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER invoice_payment_total_guard
BEFORE INSERT OR UPDATE OR DELETE ON app.invoice_payment
FOR EACH ROW EXECUTE FUNCTION app_private.check_invoice_payment_total();

CREATE TABLE app.construction_project (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  building_id uuid NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, building_id) REFERENCES app.building_address(workspace_id, id) ON DELETE RESTRICT,
  CHECK (length(trim(name)) > 0)
);

CREATE TABLE app.project_membership (
  project_id uuid NOT NULL REFERENCES app.construction_project(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES app.user_account(id) ON DELETE RESTRICT,
  role text NOT NULL DEFAULT 'guest' CHECK (role = 'guest'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE app.project_invitation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES app.construction_project(id) ON DELETE RESTRICT,
  email text NOT NULL,
  token_hash char(64) NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  invited_by uuid NOT NULL REFERENCES app.user_account(id) ON DELETE RESTRICT,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (length(trim(email)) BETWEEN 3 AND 320)
);
CREATE INDEX project_invitation_email_lower ON app.project_invitation(lower(email));

CREATE TABLE app.project_movement (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  movement_type text NOT NULL CHECK (movement_type IN ('advance', 'supplier_payment', 'reimbursement', 'supplier_refund', 'return')),
  occurred_on date NOT NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  invoice_id uuid,
  evidence_document_id uuid,
  paid_in_cash boolean NOT NULL DEFAULT false,
  note text,
  created_by uuid NOT NULL REFERENCES app.user_account(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, project_id) REFERENCES app.construction_project(workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, invoice_id) REFERENCES app.supplier_invoice(workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, evidence_document_id) REFERENCES app.stored_document(workspace_id, id) ON DELETE RESTRICT,
  CHECK (paid_in_cash = false OR evidence_document_id IS NULL)
);
CREATE INDEX project_movement_project_date ON app.project_movement(workspace_id, project_id, occurred_on);

CREATE TABLE app.project_document (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  document_id uuid NOT NULL,
  shared_by uuid NOT NULL REFERENCES app.user_account(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, document_id),
  FOREIGN KEY (workspace_id, project_id) REFERENCES app.construction_project(workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, document_id) REFERENCES app.stored_document(workspace_id, id) ON DELETE RESTRICT
);

CREATE TABLE app.audit_event (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES app.workspace(id) ON DELETE RESTRICT,
  actor_user_id uuid REFERENCES app.user_account(id) ON DELETE RESTRICT,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  CHECK (length(trim(action)) > 0 AND length(trim(entity_type)) > 0)
);
CREATE INDEX audit_event_workspace_time ON app.audit_event(workspace_id, occurred_at DESC);

CREATE FUNCTION app_private.actor_user_id() RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE
SET search_path = pg_catalog
AS $$ SELECT nullif(current_setting('app.actor_user_id', true), '')::uuid $$;

CREATE FUNCTION app_private.owns_workspace(target_workspace_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = app, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1 FROM workspace_membership m
    WHERE m.workspace_id = target_workspace_id
      AND m.user_id = app_private.actor_user_id()
      AND m.role IN ('owner', 'administrator')
  )
$$;

CREATE FUNCTION app_private.is_project_member(target_project_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = app, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1 FROM project_membership m
    WHERE m.project_id = target_project_id
      AND m.user_id = app_private.actor_user_id()
  )
$$;

CREATE FUNCTION app_private.can_read_document(target_document_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = app, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1 FROM project_document d
    WHERE d.document_id = target_document_id
      AND app_private.is_project_member(d.project_id)
  )
  OR EXISTS (
    SELECT 1 FROM project_movement m
    WHERE m.evidence_document_id = target_document_id
      AND app_private.is_project_member(m.project_id)
  )
  OR EXISTS (
    SELECT 1 FROM project_movement m
    JOIN supplier_invoice i
      ON i.workspace_id = m.workspace_id AND i.id = m.invoice_id
    WHERE i.invoice_document_id = target_document_id
      AND app_private.is_project_member(m.project_id)
  )
$$;

ALTER TABLE app.workspace ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_owner_read ON app.workspace FOR SELECT USING (app_private.owns_workspace(id));
ALTER TABLE app.workspace_membership ENABLE ROW LEVEL SECURITY;
CREATE POLICY membership_self_or_owner_read ON app.workspace_membership FOR SELECT USING (user_id = app_private.actor_user_id() OR app_private.owns_workspace(workspace_id));

ALTER TABLE app.user_account ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_self_or_workspace_owner_read ON app.user_account FOR SELECT USING (
  id = app_private.actor_user_id() OR EXISTS (
    SELECT 1 FROM app.workspace_membership m
    WHERE m.user_id = user_account.id AND app_private.owns_workspace(m.workspace_id)
  )
);

ALTER TABLE app.building_address ENABLE ROW LEVEL SECURITY;
CREATE POLICY building_owner_all ON app.building_address USING (app_private.owns_workspace(workspace_id)) WITH CHECK (app_private.owns_workspace(workspace_id));
ALTER TABLE app.unit ENABLE ROW LEVEL SECURITY;
CREATE POLICY unit_owner_all ON app.unit USING (app_private.owns_workspace(workspace_id)) WITH CHECK (app_private.owns_workspace(workspace_id));
ALTER TABLE app.tax_profile ENABLE ROW LEVEL SECURITY;
CREATE POLICY tax_profile_owner_all ON app.tax_profile USING (app_private.owns_workspace(workspace_id)) WITH CHECK (app_private.owns_workspace(workspace_id));
ALTER TABLE app.category ENABLE ROW LEVEL SECURITY;
CREATE POLICY category_owner_all ON app.category USING (app_private.owns_workspace(workspace_id)) WITH CHECK (app_private.owns_workspace(workspace_id));
ALTER TABLE app.financial_entry ENABLE ROW LEVEL SECURITY;
CREATE POLICY financial_entry_owner_all ON app.financial_entry USING (app_private.owns_workspace(workspace_id)) WITH CHECK (app_private.owns_workspace(workspace_id));
ALTER TABLE app.stored_document ENABLE ROW LEVEL SECURITY;
CREATE POLICY document_owner_or_shared_read ON app.stored_document FOR SELECT USING (app_private.owns_workspace(workspace_id) OR app_private.can_read_document(id));
CREATE POLICY document_owner_write ON app.stored_document FOR INSERT WITH CHECK (app_private.owns_workspace(workspace_id));
CREATE POLICY document_owner_update ON app.stored_document FOR UPDATE USING (app_private.owns_workspace(workspace_id)) WITH CHECK (app_private.owns_workspace(workspace_id));
CREATE POLICY document_owner_delete ON app.stored_document FOR DELETE USING (app_private.owns_workspace(workspace_id));
ALTER TABLE app.entry_document ENABLE ROW LEVEL SECURITY;
CREATE POLICY entry_document_owner_all ON app.entry_document USING (app_private.owns_workspace(workspace_id)) WITH CHECK (app_private.owns_workspace(workspace_id));
ALTER TABLE app.supplier_invoice ENABLE ROW LEVEL SECURITY;
CREATE POLICY invoice_owner_all ON app.supplier_invoice USING (app_private.owns_workspace(workspace_id)) WITH CHECK (app_private.owns_workspace(workspace_id));
ALTER TABLE app.invoice_payment ENABLE ROW LEVEL SECURITY;
CREATE POLICY payment_owner_all ON app.invoice_payment USING (app_private.owns_workspace(workspace_id)) WITH CHECK (app_private.owns_workspace(workspace_id));
ALTER TABLE app.construction_project ENABLE ROW LEVEL SECURITY;
CREATE POLICY project_owner_or_member_read ON app.construction_project FOR SELECT USING (app_private.owns_workspace(workspace_id) OR app_private.is_project_member(id));
CREATE POLICY project_owner_write ON app.construction_project FOR INSERT WITH CHECK (app_private.owns_workspace(workspace_id));
CREATE POLICY project_owner_update ON app.construction_project FOR UPDATE USING (app_private.owns_workspace(workspace_id)) WITH CHECK (app_private.owns_workspace(workspace_id));
CREATE POLICY project_owner_delete ON app.construction_project FOR DELETE USING (app_private.owns_workspace(workspace_id));
ALTER TABLE app.project_membership ENABLE ROW LEVEL SECURITY;
CREATE POLICY project_member_self_or_owner_read ON app.project_membership FOR SELECT USING (
  user_id = app_private.actor_user_id() OR EXISTS (
    SELECT 1 FROM app.construction_project p WHERE p.id = project_id AND app_private.owns_workspace(p.workspace_id)
  )
);
CREATE POLICY project_membership_owner_write ON app.project_membership FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM app.construction_project p WHERE p.id = project_id AND app_private.owns_workspace(p.workspace_id))
);
CREATE POLICY project_membership_owner_delete ON app.project_membership FOR DELETE USING (
  EXISTS (SELECT 1 FROM app.construction_project p WHERE p.id = project_id AND app_private.owns_workspace(p.workspace_id))
);
ALTER TABLE app.project_invitation ENABLE ROW LEVEL SECURITY;
CREATE POLICY invitation_project_owner_all ON app.project_invitation USING (
  EXISTS (SELECT 1 FROM app.construction_project p WHERE p.id = project_id AND app_private.owns_workspace(p.workspace_id))
) WITH CHECK (
  EXISTS (SELECT 1 FROM app.construction_project p WHERE p.id = project_id AND app_private.owns_workspace(p.workspace_id))
);
ALTER TABLE app.project_movement ENABLE ROW LEVEL SECURITY;
CREATE POLICY project_movement_owner_or_member_read ON app.project_movement FOR SELECT USING (
  app_private.owns_workspace(workspace_id) OR app_private.is_project_member(project_id)
);
CREATE POLICY project_movement_owner_insert ON app.project_movement FOR INSERT WITH CHECK (app_private.owns_workspace(workspace_id));
CREATE POLICY project_movement_owner_update ON app.project_movement FOR UPDATE USING (app_private.owns_workspace(workspace_id)) WITH CHECK (app_private.owns_workspace(workspace_id));
CREATE POLICY project_movement_owner_delete ON app.project_movement FOR DELETE USING (app_private.owns_workspace(workspace_id));
ALTER TABLE app.project_document ENABLE ROW LEVEL SECURITY;
CREATE POLICY project_document_owner_or_member_read ON app.project_document FOR SELECT USING (
  app_private.owns_workspace(workspace_id)
  OR app_private.is_project_member(project_id)
);
CREATE POLICY project_document_owner_insert ON app.project_document FOR INSERT WITH CHECK (app_private.owns_workspace(workspace_id));
CREATE POLICY project_document_owner_delete ON app.project_document FOR DELETE USING (app_private.owns_workspace(workspace_id));
ALTER TABLE app.audit_event ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_event_owner_read ON app.audit_event FOR SELECT USING (app_private.owns_workspace(workspace_id));
CREATE POLICY audit_event_owner_insert ON app.audit_event FOR INSERT WITH CHECK (app_private.owns_workspace(workspace_id));

REVOKE ALL ON SCHEMA app_private FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA app FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app_private FROM PUBLIC;

COMMIT;
