# Architecture and security boundaries

## Current state

The web application is a generic Next.js PWA shell. The annual ledger UI now uses authenticated session and ledger APIs for reads, edits, deletion, CSV import, and CSV export. A Cloudflare Access JWT gate protects dynamic page and route requests at the Next.js Proxy boundary. The API resolves an already-provisioned Access email to an application user inside a transaction-scoped PostgreSQL session. No production database is configured or deployed. Invoice extraction runs locally in the browser: PDF.js reads native PDF text first, and only pages with insufficient readable text are rendered for local Tesseract.js OCR. Extracted fields and line items remain suggestions until reviewed. Project mandate drafts, reproducible PDFs from template `mandat-debours-v1.0`, and basic electronic-signature evidence are implemented; specialist signing, provider sync, malware scanning, and production deployment remain unavailable.

`infra/postgres/migrations/0001_initial.sql` is the first relational model for workspaces, addresses and units, annual tax profiles, categorized ledger entries, stored-document metadata, supplier invoices and partial payments, construction projects, project participants, debours movements, and audit events. Later migrations add server-only email lookup, CSV import references, invoice extraction/search, scoped invitations, and immutable-after-first-signature project mandate records. Mandate evidence binds the verified account email, consent, timestamp, and a SHA-256 digest of the canonical mandate data. `infra/postgres/tests/rls_smoke.sql` exercises the database's workspace and project visibility boundaries with a non-owner role. GitHub Actions applies all migrations and runs the smoke checks against PostgreSQL 18.

The schema stores document metadata and object keys only. Invoice files, mandates, signatures, bank proofs, and database backups belong in private operator-controlled storage and must not enter this repository. The authenticated project export endpoint produces a no-store ZIP containing a JSON index, semicolon-separated chantier register, mandate/signature metadata, and integrity-checked project evidence. Archive generation is capped at 100 files and 100 MiB.

## Access model

- The workspace owner and administrators can access fiscal records.
- A project guest can read only assigned projects, their movements, and evidence or invoice documents linked to those projects. The initial policy is read-only for guests; the owner records and corrects project movements.
- Composite foreign keys bind units, entries, projects, and documents to the same workspace. Project-document links cannot cross workspace boundaries.
- Invoice payment allocations can be partial. A trigger serializes allocations per invoice and rejects totals above the invoice amount.
- The database migration does not create application login roles or production grants. Runtime access must use a separate, non-superuser and non-table-owner role. Table ownership bypasses ordinary row-level security unless additional PostgreSQL configuration is used.
- The `app.actor_user_id` setting is an application context value, not an authentication credential. The server verifies the Cloudflare Access identity before opening a transaction, then resolves it to a local user and sets the actor within that transaction. Never expose PostgreSQL to the browser or accept an actor ID supplied by the browser.
- The Next.js Proxy verifies the signed `Cf-Access-Jwt-Assertion`, expected issuer and app audience, and the token's expiration before allowing dynamic requests through. It reads identity from the verified JWT, never from a client-provided email header.
- `web/.env.example` documents non-secret team-domain and audience settings. The local bypass is honored only when `NODE_ENV=development`; production without the Access settings fails closed. Configure the Cloudflare Access application and keep the origin reachable only through the intended trusted path before deployment.
- The API verifies the Access JWT again, resolves its verified email through a `SECURITY DEFINER` lookup, and sets `app.actor_user_id` with transaction-local `set_config(..., true)`. Each request uses one database transaction; failed imports roll back all rows. Connections are committed or rolled back before being returned to the pool.

## First database setup

Apply every SQL file in `infra/postgres/migrations/` in filename order as the schema owner. Create the owner's account, first workspace, one building address, and its three apartment units once using `infra/postgres/ops/bootstrap_owner.sql`; pass the actual email, display name, address fields, workspace name, and unit references as `psql -v` values at deployment time. These values must stay out of Git.

Run `infra/postgres/ops/grant_runtime_session_access.sql` as the database owner, create a separate `LOGIN` role with a secret managed outside the repository, then grant that login role membership in `app_runtime`. Apply `grant_runtime_ledger_access.sql` to enable the current register API, building/unit lookups, and invoice attachment metadata. Put the resulting connection string in `DATABASE_URL` and set `PRIVATE_DOCUMENTS_DIR` to an operator-mounted private volume outside the source checkout. The first script grants the session reads; the second grants only the ledger and audit operations currently used. Never make the login role a table owner, superuser, or `BYPASSRLS` role.

## Not yet implemented

- Cloudflare Access policy setup and the initial owner workspace/address/unit bootstrap remain operator configuration. Project invitation issuance, verified-email acceptance, guest provisioning, and project-scoped membership are implemented; adding each invited email to the Cloudflare Access allow policy still requires deployment configuration. Project reads are scoped for members; movement writes remain owner-only.
- Workspace creation, invitation acceptance, and server-side row error reporting with line numbers. The current UI previews CSV rows locally; the server reparses and commits the full file atomically. The CI role uses broader grants solely to exercise row-level policies.
- Malware scanning, retention rules, and safe handling of untrusted uploads. Authenticated owner-only ledger upload and preview now exist but are not production-ready without the remaining controls described below.
- Import and reconciliation of the existing workbook, formal tax review, and tax-form validation. CSV backup/export and atomic CSV import are implemented in the current register.
- A versioned, generated PDF mandate matching the supplied signed example; template `mandat-debours-v1.0` is currently generic and generated on demand.
- Legal review of the simple electronic-signature evidence flow, and a qualified or specialist signature provider if the required assurance level calls for it.
- Google Drive, Microsoft, or SFTP synchronization and conflict resolution.
- Operational backup/restore, audit retention, deployment secrets, and Proxmox installation.

Do not put real accounting records in this schema until authentication, transaction-scoped identity, file authorization, backup/restore, and migration procedures have been implemented and reviewed.


## Invoice document storage

Invoice bytes are stored only on the operator-mounted absolute PRIVATE_DOCUMENTS_DIR path (example: /var/lib/compta-immo/documents), using opaque workspace/document UUID paths. The upload endpoint accepts PDF, JPEG, PNG, and WebP files up to 25 MiB after signature checks. PostgreSQL stores metadata, the original display filename, size, and SHA-256 digest. Preview rechecks authorization, size, and digest and responds with private no-store headers. The path must be outside the source checkout and must never be copied to GitHub.

This is not malware scanning. The upload flow is not production-ready until malware scanning, retention, backup/restore, volume permissions, operational monitoring, and live tests against PostgreSQL and the mounted volume are complete. Current links are ledger-owner-only; project guest attachment access is a later project-specific slice.

## Invoice extraction

The browser first extracts each PDF page's native text with PDF.js. It renders only pages that fail the readable-text threshold, with a 16-million-pixel page cap, then runs Tesseract.js with the French model on the device. JPEG, PNG, and WebP inputs go directly to local OCR. The original invoice is uploaded to private storage; extracted text, suggested fields, line descriptions, page provenance, and review state are stored in PostgreSQL. Native PDF text has no OCR confidence score; OCR-derived rows carry the engine confidence. Extracted supplier, reference, date, totals, and line amounts are not tax classifications and must be checked by the user. Reruns are refused when confirmed line items exist. The browser limits files to 25 MiB and PDFs to 20 pages.

The OCR/PDF workers, WASM cores, French model, PDF CMaps, and standard fonts are copied from pinned npm packages into ignored build output under `web/public/ocr`. This keeps OCR assets same-origin and avoids sending invoice contents to an external OCR service. Deployments must run the asset-copy lifecycle script before serving the app.

Invoice search is executed on the server within the selected project. French full-text GIN indexes cover supplier/reference and product/service descriptions; B-tree indexes cover invoice totals and line totals. Amount filters match either the invoice total or a line total. Filtered invoice rows do not change the separately computed full-project debours balance.


## Project debours

The owner can create a project for a building address, record advances, supplier payments, reimbursements, supplier refunds, and returns, and see the two-way outstanding balance plus amounts awaiting invoice support. Project invoices are added with extracted or manually entered supplier, optional number/date, total, and an uploaded file, then remain marked for review. Linked invoice payments are capped at the invoice total while holding the invoice row lock. Owners can add, replace, or detach a movement's proof after entry; the change is audited and old files stay in the project document store. A project guest can read assigned-project movements and documents, but cannot write. Owners and assigned project guests can download a private ZIP with the project register, a generated PDF for each mandate, and available evidence. These calculations are operational reconciliation only; they do not determine deductibility or tax treatment.

Project owners can create a seven-day invitation for a specific email. The bearer token is 256 random bits, stored only as a SHA-256 hash, single-use, and accepted only when the verified Cloudflare Access email matches the invited email. Acceptance provisions an active guest account when one does not exist and adds membership to that project only. Owners can revoke a pending invitation or remove an accepted guest from that project. The app provides a copyable link and a prefilled `mailto:` draft, but does not send email itself. The owner must also add invited emails to the Cloudflare Access policy, which is not provisioned automatically by the application.

## Project mandates and signature evidence

The owner can create a mandate draft with both parties, authorized purchases, a TTC ceiling, terms, and a validity interval. Each party signs only when the authenticated Cloudflare Access email matches the e-mail assigned to that party. The first signature locks the mandate content; each signature stores the signer account, consent text, timestamp, and the digest of canonical mandate data. The server generates a reproducible PDF from the clean `mandat-debours-v1.0` template on demand; the digest printed in it identifies canonical mandate data, not the PDF bytes. A user-selected signature image may be attached by the owner; it remains a separate visual file and is not embedded in the generated PDF. No qualified electronic signature is provided. These records are evidence of the in-app signing action, not a legal determination about the signature's reliability or sufficiency.


Fiscal product guardrails and official sources are documented in [docs/tax-guardrails.md](tax-guardrails.md). The project screen distinguishes VAT “débours” conditions from rental-income deductibility and makes no automatic tax determination. Pre-letting work must be reviewed against the current official guidance; no invoice in this application is automatically treated as deductible.
