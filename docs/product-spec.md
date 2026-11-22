# Product specification: Compta Immo

## Product goal

A modular, self-hosted PWA for French real-estate owners to track properties, apartments, rental income, expenses and supporting documents, prepare annual tax summaries, and manage construction advances and reimbursements.

## Initial real-estate model

- A property address/building may contain zero or more apartments (units).
- Transactions may apply to the whole building, one unit, or a documented allocation across units.
- The initial deployment profile supports unfurnished residential rental at the real-income regime, while storing year-effective tax profiles separately per unit so later changes do not rewrite historical years.
- Tax status is explicit: draft, needs review, confirmed for a specified annual form, excluded from that export. OCR never confirms tax eligibility.

## Documents and transactions

- Store private originals outside GitHub, with a content hash, upload provenance, access checks and temporary preview access.
- Importing an invoice creates draft metadata; amount/date/vendor extraction is a proposal, always editable and confirmed by a person.
- Preserve exact amounts in integer cents and currencies explicitly.
- Annual CSV import is staged and previewed before an atomic commit; export records a schema version and does not include the document bytes.

## Invoice OCR, line items, and search

- Extract invoice supplier, invoice date, invoice number, total, tax totals, and every detected product/service line into editable draft fields.
- Keep each line's original description, quantity, unit, unit price, tax rate, and line total where present. Preserve page/source references and OCR confidence so a person can compare each value with the original page and correct it.
- Show all extracted lines in a review table before confirmation. Never silently infer missing quantities, tax rates, or line totals; flag conflicts and arithmetic mismatches.
- Search and filter across invoices and line items by supplier, invoice reference/date, invoice or line amount range, product/service text, property address, apartment, and chantier, subject to workspace/project access rules.
- OCR and search metadata remain private application data. OCR proposals never confirm an invoice, accounting category, or tax eligibility.

## Construction projects

- A project belongs to a building address and may be allocated to units. Invitations are scoped to one or more named projects.
- Track cash advances before invoices, invoices, actual supplier payments, partial payments, refunds/reimbursements, and evidence as distinct records.
- Derive amounts owed in both directions and the remaining unsubstantiated advance from the ledger; do not let users hand-edit computed balances.
- Track an internal-only amount separately from tax/export amounts. Internal-only entries remain in project budgets and are excluded from designated administrative/tax exports. This flag is not a legal tax classification.
- Project exports are ZIPs containing an index, mandate, invoice/advance/reimbursement table and available evidence.

Current implementation: owners can add, replace or detach a movement's payment evidence after entry. Each change is recorded in the audit log; previously attached documents remain preserved in project storage. Guests have read-only access.

Current implementation: the authenticated project ZIP includes a JSON index, French semicolon-separated invoice/movement register, mandate and signature metadata, and integrity-checked evidence. It is limited to 100 documents and 100 MiB per archive.

## Mandates and signatures

- Generate a fresh PDF from a clean, versioned template. Never copy signatures from an already signed example.
- Support an optional user-selected signature appearance (drawn, typed or uploaded) per signer. That image is visual only, not proof by itself.
- Signature evidence must bind signer's verified identity and consent, document digest, version, timestamp, and event log; use a specialist signature provider after legal review of the required level.

Implementation status: mandate drafts, party-specific signing tied to verified Cloudflare Access email, first-signature content lock, digest and event logging are available. The current generic form has fields for purchase limits, authorized materials, terms, and validity dates. It prints through the browser and can include an owner-uploaded signature image. It does not yet reproduce the supplied template exactly, generate a PDF artifact in the application, provide individual image selection for every signer, or establish legal sufficiency. Keep this path under review until the actual template, output artifact, and required signature assurance are agreed and checked.

## Authentication and authorization

- Site entry is restricted by Cloudflare Access using Google identity and/or email OTP. Verify the Access JWT server-side.
- Application roles are stored and enforced server-side: owner full access, invited project member only assigned project resources.
- The initial owner's email is injected as a secret/configuration value at deployment, never committed to this public repository.

## Storage and integrations

- The public GitHub repository contains source and generic docs only. It never contains real names, emails, addresses, invoices, mandates, signatures, balances, database files, backups, secrets or production logs.
- PostgreSQL and private object storage run on the operator's server infrastructure outside GitHub.
- External storage connectors are provider adapters: Microsoft first (OneDrive or SharePoint pending account type), Google Drive and configurable SFTP later. Per-folder policy can be manual, automatic or scheduled; manual is default; conflicts are resolved explicitly; deletes never propagate implicitly.

## Initial technical choices

- Web/PWA: Next.js App Router and TypeScript, self-hosted as a Node server/container.
- Runtime: Node.js 24 LTS target; local environment may use another currently supported LTS that meets framework requirements.
- Database: PostgreSQL 18 for production, with migrations and integration tests against a real PostgreSQL service.
- Runtime hosting: Docker Compose on a VM/container on Proxmox, reverse proxy and Cloudflare Tunnel/Access; no public database port.
- Authentication proxy: Cloudflare Access; application still enforces its own per-project permissions.
- Offline behavior: cache the static app shell only; never cache private invoice pages, documents or exports.

## Public references

- Next.js installation / supported Node versions: https://nextjs.org/docs/app/getting-started/installation
- Next.js PWA guide: https://nextjs.org/docs/app/guides/progressive-web-apps
- Next.js self-hosting: https://nextjs.org/docs/app/guides/self-hosting
- Node.js release schedule: https://nodejs.org/en/about/previous-releases
- PostgreSQL supported versions: https://www.postgresql.org/support/versioning/
- Cloudflare Access OTP: https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/
