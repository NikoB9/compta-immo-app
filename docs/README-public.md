# Public repository boundary

Repository name: `compta-immo-app` (intended public GitHub repository).

## Allowed

- Source code, migrations containing schema only, generic technical/product documentation, CI configuration, dependency manifests, fictional fixtures, and public issue/PR discussion without user data.

## Prohibited

- Real names/emails, property addresses, tax/profile values, bank/account details, amounts copied from the real workbook, invoices/receipts, mandate scans, signature images, signer evidence, database exports, backups, credentials, tokens, private hostnames/IPs, and production logs.
- Never put an actual `.env` file or a copy of production data in a pull request or issue attachment.

## Runtime boundary

The PostgreSQL database, private document object store, and backups run on separately administered server infrastructure. They do not live in the GitHub repository. Secrets are injected through the runtime's secret manager/environment and never committed.

Use `.env.example` only with fake placeholders. CI and development use synthetic fixtures. Before the first public push, review the full staged diff and commit history for secrets and real data; keep personal operational notes and source-data analysis outside this public repository.

## Storage integrations

The product is designed for provider adapters: Microsoft first, followed by Google Drive and configurable SFTP. Runtime sync credentials and file identifiers are private application data and never belong in this repository.
