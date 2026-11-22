\set ON_ERROR_STOP on

-- Run once as the database owner. Supply values with psql -v; never commit
-- the real owner's email, display name, or workspace name to this repository.
BEGIN;

INSERT INTO app.user_account (email, display_name)
VALUES (:'owner_email', :'owner_display_name')
ON CONFLICT (lower(email))
DO UPDATE SET display_name = EXCLUDED.display_name
RETURNING id AS owner_id \gset

INSERT INTO app.workspace (name)
VALUES (:'workspace_name')
RETURNING id AS workspace_id \gset

INSERT INTO app.workspace_membership (workspace_id, user_id, role)
VALUES (:'workspace_id', :'owner_id', 'owner');

INSERT INTO app.building_address (
  workspace_id, label, address_line1, address_line2, postal_code, locality, country_code
)
VALUES (
  :'workspace_id',
  :'building_label',
  :'address_line1',
  NULLIF(:'address_line2', ''),
  :'postal_code',
  :'locality',
  'FR'
)
RETURNING id AS building_id \gset

INSERT INTO app.unit (workspace_id, building_id, unit_ref, description) VALUES
  (:'workspace_id', :'building_id', :'unit_ref_1', NULL),
  (:'workspace_id', :'building_id', :'unit_ref_2', NULL),
  (:'workspace_id', :'building_id', :'unit_ref_3', NULL);

COMMIT;
