# Foundation and First Domain Rules

> Follow the executing-plans workflow. Keep all real property, accounting and identity data outside this public source repository.

**Goal:** Start a public-safe, self-hostable PWA and build the first reusable accounting rules without inventing tax classifications.

**Architecture:** Next.js App Router frontend, isolated pure domain package, PostgreSQL schema with row-level access policies, and operator-mounted private document storage. The schema is connected to authenticated ledger and document routes; no production records or production deployment are present.

**Runtime:** Next.js 16, Node.js 24 target, npm, Node's built-in test runner, PostgreSQL 18 target for the database slice.

## Constraints

- GitHub receives generic source and documentation only. No real names, emails, addresses, invoices, declarations, signatures, amounts, databases, backups or secrets.
- CSV import previews rows locally, then the server reparses and commits the import atomically.
- CSV review status is provenance. Imported rows always return as `needs_review` and are never confirmed by import.
- Debours balances are operational calculations, not a legal or tax classification.
- No service worker or offline cache is enabled; private data must never enter a public cache.
- No production deploy. Push only generic source and documentation to the public repository.

## Implemented

- Responsive generic French landing page with accounting and construction-project areas.
- Annual accounting screen at `/comptabilite` with year selection, manual add/edit/delete, CSV preview/import and CSV download. Entries persist through the authenticated PostgreSQL ledger APIs; runtime deployment still needs provisioning.
- PWA manifest and generic SVG icons.
- Node 24 target in `.nvmrc` and package engine; GitHub Actions CI with read-only repository permissions.
- Private vulnerability reporting and public-data handling guidance.
- Integer-cent euro parsing and operational debours reconciliation, including invoices, partial supplier payments, refunds, returns, two-way balances and amounts awaiting invoice support.
- Annual ledger CSV v2: French semicolon export, comma/semicolon input, quoted fields, year filtering, errors and duplicate detection. It preserves the administrative and internal shares, and still imports v1 by treating its full amount as administrative.
- The annual entry form includes a cent-level range control for the administrative share. The remaining paid amount appears as internal-only expenses.
- First PostgreSQL 18 schema migration for multi-address workspaces, buildings and units, annual tax profiles, fiscal entries, documents, invoices, partial payments, projects, invitations, debours movements, and audit events.
- Database row-level policies for workspace-owner fiscal access and read-only, project-scoped guest access. Composite foreign keys prevent cross-workspace unit/document links; a payment-allocation trigger prevents invoice overpayment.
- PostgreSQL 18 GitHub Actions job with a smoke script that checks workspace isolation, guest fiscal-data denial, project evidence access, guest write denial, invoice overpayment rejection, and cross-workspace document-link rejection.
- `docs/architecture.md` records current data boundaries, trust assumptions, and unimplemented production requirements.
- Cloudflare Access gate at the Next.js 16 Proxy boundary. It verifies the signed application JWT with the configured team issuer and audience and requires a verified user email; direct trust of an email header is not used. Local bypass requires an explicit development-only environment flag.
- A PostgreSQL connection pool and `/api/auth/session` endpoint. The endpoint re-verifies the Access assertion, resolves only an already-provisioned user, sets the actor with transaction-local scope, and returns that user's owner workspaces and assigned projects with `no-store` caching.
- Follow-up migration for secure email-to-user lookup, plus parameterized owner-bootstrap and read-only session-role grant scripts that keep real account details out of source control.
- Persistent annual ledger APIs for year-scoped reads and create/update/delete. The annual UI now loads from PostgreSQL, lets the owner select a workspace, address, and optional apartment, and refreshes only after server success.
- Server-reparsed CSV import in one database transaction. It validates the year, references, cents and descriptions, rejects duplicate IDs atomically, and records a count-only audit event. The import is capped at 2 MiB and 5,000 rows. Migrations preserve external CSV IDs and imported category/document references.
- The owner bootstrap accepts runtime values for the workspace, one address, and three apartment references. No personal property or identity data is stored in the repository.

- Private invoice/justificatif upload and preview use the operator-mounted PRIVATE_DOCUMENTS_DIR, never PostgreSQL or Git for file bytes. Uploads are capped at 25 MiB and limited by signature to PDF/JPEG/PNG/WebP; preview revalidates authorization and SHA-256. Annual ledger rows list linked files and allow upload/open-preview. This is not malware scanning.

- Project UI/API now creates projects by address, adds project invoices with supplier/date/number/total fields and uploaded documents, records advances/payments/reimbursements/refunds/returns, and shows the two-way debours reconciliation. Existing project guests can read assigned-project data; all mutation routes enforce owner access. Invoice/payment amounts stay marked for review.
- Planned invoice extraction explicitly includes every detected product/service line, editable source-traceable fields, and permission-scoped filtering/search by invoice and line-item amount/text.
- Added local invoice extraction with PDF.js: every PDF page is checked for readable native text first; only pages without usable text are rendered to a bounded canvas for local Tesseract.js OCR. OCR worker, French model, PDF worker, and WASM assets are copied from pinned packages at build/dev startup and served from the same origin. Invoice metadata and candidate line amounts remain suggestions that require review. Each line shows its source and OCR confidence when available, and can be edited, confirmed, or excluded. Private APIs store extracted and reviewed fields, source text, page provenance, and review state; reruns cannot replace confirmed rows.
- Added PostgreSQL storage for OCR runs and product/service lines with source page, confidence, review state, tax amount/rate fields, workspace RLS, guest project read policy, and runtime grants. The project invoice API returns these rows; the chantier UI displays them and searches by French full-text supplier/reference/product terms and invoice or line amount through PostgreSQL GIN/B-tree indexes. Search results are project-scoped, while the debours reconciliation continues to use every project invoice regardless of the active filter.
- Added owner-only project invitations with a one-time 256-bit token stored only as a SHA-256 hash, seven-day expiry, verified-Cloudflare-email matching, guest account provisioning on acceptance, project membership insertion, invitation revocation, guest access removal, and audit events. Owners can copy a link or open a prefilled mail draft. The secret is passed in the link fragment, not the server URL. The link uses configured `APP_BASE_URL` (local development can use its local origin).
- Added an in-app fiscal guardrail note and linked official tax sources. It distinguishes the VAT definition of débours from French property-income expense deductibility and flags pre-letting work for human review; it makes no tax qualification. Supporting source notes are in docs/tax-guardrails.md.

## Verification status (updated 2026-11-22)

- `npm test`: passed, 18 domain tests.
- `tsc --noEmit --incremental false`: passed.
- Initial `npm run build` before PostgreSQL dependencies: passed after setting the Turbopack root for the shared domain package and rendering the year selector at request time. After adding `pg`, the Windows OneDrive checkout blocks Turbopack's junction creation. Webpack compiles successfully, but final static output hits a OneDrive `EPERM` error.
- `npm run lint`: did not finish after more than 60 seconds while loading ESLint configuration; stopped, not a pass.
- Browser preview: local dev server reported ready, but the browser connection to `localhost:3000` timed out in this execution environment.
- GitHub Actions run 24 completed successfully on the latest PR head: PostgreSQL 18 migrations (including 0005), RLS smoke checks, 18 domain tests, ESLint, and the Next.js production build all passed.
- Migration 0005 and the RLS smoke script passed in GitHub Actions PostgreSQL 18; they have not been run in the local Windows environment (psql unavailable, Docker inaccessible).
- `npx tsc --noEmit --incremental false`: passed with the Access verifier, PostgreSQL pool, and session API.
- `npx tsc --noEmit --incremental false`: passed with the ledger endpoints and UI integration.
- Local `npx tsc --noEmit --incremental false` after invoice line-item changes did not finish within 30 seconds; GitHub Actions production build passed on the same source revision.
- Webpack compiled the complete app successfully with `webpackBuildWorker` disabled for diagnosis, but the build then failed during static output work with Windows OneDrive `EPERM`. The default Turbopack build also cannot create a junction for the external `pg` package (OS access denied). GitHub CI runs on Linux.
- The PostgreSQL schema and RLS smoke tests have been executed in GitHub Actions, not against a production database. Invoice routes and private-volume behavior still need a runtime integration smoke test.
- Invoice upload/preview and project movement/invoice routes have not been exercised against a mounted private volume or live PostgreSQL database in this environment.

## Next tasks

1. Configure Cloudflare Access to restrict site entry to the owner and invited emails, bootstrap the owner workspace/address/units, and verify owner/guest isolation. The app creates and validates invitations; adding each invited email to the Cloudflare Access allow policy still requires deployment configuration.
2. Implement payment-evidence lifecycle, generated versioned mandate PDF/signing integration, provider sync, and Proxmox deployment.
3. Add malware scanning, backups, retention, accessibility verification, and a live PostgreSQL/private-volume smoke run before production use.
4. Run invitation, signing, provider-sync, backup/restore, and private-volume checks as those slices are implemented; keep production deployment blocked until these operational controls are complete.

## Key files

- `web/src/app/page.tsx`
- `web/src/app/manifest.ts`
- `packages/domain/src/money.js`
- `packages/domain/src/reconcile-debours.js`
- `packages/domain/src/annual-csv.js`
- `packages/domain/test/`
- `.github/workflows/ci.yml`
- `SECURITY.md`
