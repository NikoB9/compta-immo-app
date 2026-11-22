# Compta Immo App

Open-source application for managing real-estate rental records, supporting documents, construction-project advances, reconciliations, and annual exports.

## Data boundary

This repository contains application code and generic technical documentation only. Do not commit personal information, real property addresses, source spreadsheets, invoices, mandate scans, signatures, credentials, database files, backups, or production data. Use fictional data for examples and development.

The runtime database and private document store belong on the operator's server infrastructure, outside GitHub. GitHub is the public source-code host; it is not the database, file archive, or backup target.

## Project status

The public PWA shell, Cloudflare Access gate, authenticated session and annual-ledger API are under development in `web/`. PostgreSQL schema, migrations and row-access checks are in `infra/postgres/`; no production database is configured. See `docs/architecture.md` for the current boundaries and deployment prerequisites, and `docs/README-public.md` for repository handling.
