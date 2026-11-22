import assert from "node:assert/strict";
import test from "node:test";
import { parseAnnualLedgerCsv, serializeAnnualLedgerCsv } from "../src/annual-csv.js";

const entries = [
  {
    id: "entry-2",
    taxYear: 2026,
    occurredOn: "2026-04-09",
    entryType: "expense",
    description: "Peinture; murs du séjour",
    categoryCode: "materials",
    amountCents: 2575,
    currency: "EUR",
    buildingRef: "building-a",
    unitRef: "unit-2",
    documentRef: "document-a",
    reviewStatus: "confirmed",
  },
  {
    id: "entry-1",
    taxYear: 2026,
    occurredOn: "2026-02-10",
    entryType: "income",
    description: "Loyer \"janvier\"\ncomplément",
    categoryCode: "rent",
    amountCents: 75000,
    currency: "EUR",
    buildingRef: "building-a",
    unitRef: null,
    documentRef: null,
    reviewStatus: "needs_review",
  },
  {
    id: "entry-other-year",
    taxYear: 2025,
    occurredOn: "2025-12-03",
    entryType: "expense",
    description: "Out of year",
    categoryCode: "fees",
    amountCents: 100,
    currency: "EUR",
  },
];

test("annual CSV rejects cells that spreadsheet applications could evaluate", () => {
  for (const description of ["=2+2", "  +3", "\t@SUM(1)", "＝1"]) {
    assert.throws(() => serializeAnnualLedgerCsv(2026, [{ ...entries[0], description }]), /evaluated as a formula/);
  }
});

test("annual CSV exports only the selected year in stable order", () => {
  const csv = serializeAnnualLedgerCsv(2026, entries);
  const result = parseAnnualLedgerCsv(csv, { expectedTaxYear: 2026 });

  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.deepEqual(result.errors, []);
  assert.equal(result.rows.length, 2);
  assert.deepEqual(result.rows.map(({ id }) => id), ["entry-1", "entry-2"]);
  assert.equal(result.rows[1].description, "Peinture; murs du séjour");
  assert.equal(result.rows[0].description, "Loyer \"janvier\"\ncomplément");
  assert.equal(result.rows[1].reviewStatus, "needs_review");
  assert.equal(result.rows[1].sourceReviewStatus, "confirmed");
});

test("annual CSV v2 preserves administrative and internal shares", () => {
  const entry = { ...entries[0], amountCents: 10000, administrativeAmountCents: 7200, internalOnlyCents: 2800 };
  const result = parseAnnualLedgerCsv(serializeAnnualLedgerCsv(2026, [entry]), { expectedTaxYear: 2026 });
  assert.deepEqual(result.errors, []);
  assert.equal(result.rows[0].administrativeAmountCents, 7200);
  assert.equal(result.rows[0].internalOnlyCents, 2800);
  assert.equal(result.rows[0].amountCents, 10000);
});

test("annual CSV v1 imports with the full amount in the administrative share", () => {
  const csv = [
    "schema_version;entry_id;tax_year;occurred_on;entry_type;description;category_code;amount_cents;currency;building_ref;unit_ref;document_ref;review_status",
    "ledger-v1;old-entry;2026;2026-03-01;expense;Old format;repairs;2500;EUR;;;;confirmed",
  ].join("\n");
  const result = parseAnnualLedgerCsv(csv);
  assert.deepEqual(result.errors, []);
  assert.equal(result.rows[0].administrativeAmountCents, 2500);
  assert.equal(result.rows[0].internalOnlyCents, 0);
  assert.equal(result.rows[0].reviewStatus, "needs_review");
});

test("annual CSV imports quoted comma-separated input with a review gate", () => {
  const csv = [
    "schema_version,entry_id,tax_year,occurred_on,entry_type,description,category_code,amount_cents,currency,building_ref,unit_ref,document_ref,review_status",
    'ledger-v1,external-1,2026,2026-05-01,expense,"Paint, brushes",materials,1234,EUR,building-a,,doc-1,confirmed',
  ].join("\r\n");
  const result = parseAnnualLedgerCsv(csv, { expectedTaxYear: 2026 });

  assert.deepEqual(result.errors, []);
  assert.equal(result.delimiter, ",");
  assert.equal(result.rows[0].description, "Paint, brushes");
  assert.equal(result.rows[0].reviewStatus, "needs_review");
  assert.equal(result.canImport, true);
});

test("annual CSV reports invalid rows and refuses a mismatched year", () => {
  const csv = [
    "schema_version;entry_id;tax_year;occurred_on;entry_type;description;category_code;amount_cents;currency;building_ref;unit_ref;document_ref;review_status",
    "ledger-v1;entry-a;2025;2025-04-01;expense;Item;repairs;125;EUR;;;;draft",
    "ledger-v1;entry-b;2026;2026-13-01;expense;Broken date;repairs;100;EUR;;;;draft",
  ].join("\n");
  const result = parseAnnualLedgerCsv(csv, { expectedTaxYear: 2026 });

  assert.equal(result.rows.length, 0);
  assert.equal(result.canImport, false);
  assert.deepEqual(result.errors.map(({ row, field }) => [row, field]), [
    [2, "tax_year"],
    [3, "occurred_on"],
  ]);
});

test("annual CSV rejects duplicate IDs, ragged rows, and unversioned headers", () => {
  const header = "schema_version;entry_id;tax_year;occurred_on;entry_type;description;category_code;amount_cents;currency;building_ref;unit_ref;document_ref;review_status";
  const row = "ledger-v1;same-id;2026;2026-05-01;expense;Item;repairs;125;EUR;;;;draft";
  const duplicate = parseAnnualLedgerCsv(`${header}\n${row}\n${row}`);
  assert.equal(duplicate.canImport, false);
  assert.equal(duplicate.errors[0].field, "entry_id");

  assert.equal(parseAnnualLedgerCsv(`${header}\nledger-v1;broken`).canImport, false);
  assert.equal(parseAnnualLedgerCsv("entry_id;amount\n1;100").errors[0].field, "schema_version");
  assert.equal(parseAnnualLedgerCsv(`${header}\nledger-v1;"unfinished`).errors[0].field, "csv");
});

test("annual CSV serialization rejects inconsistent paid amounts and invalid years", () => {
  assert.throws(() => serializeAnnualLedgerCsv(2026, [{
    id: "bad-entry",
    taxYear: 2026,
    occurredOn: "2026-06-01",
    entryType: "expense",
    description: "Amount too precise",
    categoryCode: "fees",
    amountCents: 1.5,
    currency: "EUR",
  }]), { name: "RangeError" });
  assert.throws(() => serializeAnnualLedgerCsv(2201, []), { name: "RangeError" });
  assert.throws(() => serializeAnnualLedgerCsv(2026, [{
    ...entries[0], amountCents: 100, administrativeAmountCents: 80, internalOnlyCents: 30,
  }]), { name: "RangeError" });
});
