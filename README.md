# Compta Immo App

Open-source application for managing real-estate rental records, supporting documents, construction-project advances, reconciliations, and annual exports.

## Data boundary

This repository contains application code and generic technical documentation only. Do not commit personal information, real property addresses, source spreadsheets, invoices, mandate scans, signatures, credentials, database files, backups, or production data. Use fictional data for examples and development.

The runtime database and private document store belong on the operator's server infrastructure, outside GitHub. GitHub is the public source-code host; it is not the database, file archive, or backup target.

## Project status

The application includes Cloudflare Access authentication, a persistent annual ledger, project and mandate workflows, private exports, and a protected first-owner setup flow. The PostgreSQL schema and migrations are deployed to the target CT; rebuilding and validating the web application and completing operational checks remain. See `docs/architecture.md` for current boundaries and `infra/deploy/README.md` for deployment steps. See `docs/README-public.md` for repository handling.
