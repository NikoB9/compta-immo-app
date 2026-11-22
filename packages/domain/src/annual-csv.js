export const ANNUAL_LEDGER_CSV_VERSION = "ledger-v2";

const VERSION_1_COLUMNS = [
  "schema_version",
  "entry_id",
  "tax_year",
  "occurred_on",
  "entry_type",
  "description",
  "category_code",
  "amount_cents",
  "currency",
  "building_ref",
  "unit_ref",
  "document_ref",
  "review_status",
];

export const ANNUAL_LEDGER_CSV_COLUMNS = [
  ...VERSION_1_COLUMNS.slice(0, 8),
  "administrative_amount_cents",
  "internal_only_cents",
  ...VERSION_1_COLUMNS.slice(8),
];

const STATUSES = new Set(["draft", "needs_review", "confirmed", "excluded"]);
const ENTRY_TYPES = new Set(["income", "expense"]);

/**
 * Create a versioned, semicolon-delimited annual ledger CSV. This is a data
 * export, not a French tax-form export and contains no document bytes.
 *
 * @param {number} taxYear
 * @param {object[]} entries
 * @returns {string}
 */
export function serializeAnnualLedgerCsv(taxYear, entries) {
  validateYear(taxYear);
  if (!Array.isArray(entries)) {
    throw new TypeError("Ledger entries must be an array.");
  }

  const selected = entries.filter((entry) => entry.taxYear === taxYear);
  selected.forEach(validateEntry);
  selected.sort((left, right) => left.occurredOn.localeCompare(right.occurredOn)
    || left.id.localeCompare(right.id));
  const rows = [ANNUAL_LEDGER_CSV_COLUMNS];

  for (const entry of selected) {
    rows.push([
      ANNUAL_LEDGER_CSV_VERSION,
      entry.id,
      String(entry.taxYear),
      entry.occurredOn,
      entry.entryType,
      entry.description,
      entry.categoryCode ?? "",
      String(entry.amountCents),
      String(entry.administrativeAmountCents ?? entry.amountCents),
      String(entry.internalOnlyCents ?? 0),
      entry.currency,
      entry.buildingRef ?? "",
      entry.unitRef ?? "",
      entry.documentRef ?? "",
      entry.reviewStatus ?? "needs_review",
    ]);
  }

  return `\ufeff${rows.map((row) => row.map(escapeCsvCell).join(";")).join("\r\n")}\r\n`;
}

/**
 * Parse an annual ledger CSV for staging and preview. Imported tax review
 * statuses are retained as provenance only: every staged record must be
 * reviewed again before it can be confirmed in the application.
 *
 * @param {string} input
 * @param {{ expectedTaxYear?: number }} [options]
 */
export function parseAnnualLedgerCsv(input, { expectedTaxYear } = {}) {
  if (typeof input !== "string") {
    throw new TypeError("CSV content must be text.");
  }
  if (expectedTaxYear !== undefined) validateYear(expectedTaxYear);

  const text = input.replace(/^\ufeff/u, "");
  const delimiter = detectDelimiter(text);
  let records;
  try {
    records = parseDelimitedText(text, delimiter);
  } catch (error) {
    return {
      delimiter,
      rows: [],
      errors: [{ row: 1, field: "csv", message: error.message }],
      canImport: false,
    };
  }

  const nonEmpty = records.filter((record) => !(record.length === 1 && record[0] === ""));
  if (nonEmpty.length === 0) {
    return {
      delimiter,
      rows: [],
      errors: [{ row: 1, field: "header", message: "CSV file is empty." }],
      canImport: false,
    };
  }

  const [header, ...data] = nonEmpty;
  const version = sameColumns(header, ANNUAL_LEDGER_CSV_COLUMNS) ? 2
    : sameColumns(header, VERSION_1_COLUMNS) ? 1 : null;
  if (version === null) {
    return {
      delimiter,
      rows: [],
      errors: [{ row: 1, field: "schema_version", message: "Unsupported CSV header or column order." }],
      canImport: false,
    };
  }

  const rows = [];
  const errors = [];
  const seenIds = new Set();
  data.forEach((cells, index) => {
    const rowNumber = index + 2;
    const before = errors.length;
    const columns = version === 2 ? ANNUAL_LEDGER_CSV_COLUMNS : VERSION_1_COLUMNS;
    if (cells.length !== columns.length) {
      errors.push({
        row: rowNumber,
        field: "_row",
        message: `Expected ${columns.length} columns but found ${cells.length}.`,
      });
      return;
    }

    const values = Object.fromEntries(columns.map((column, cellIndex) => [
      column,
      cells[cellIndex],
    ]));
    const addError = (field, message) => errors.push({ row: rowNumber, field, message });

    const expectedSchemaVersion = version === 2 ? "ledger-v2" : "ledger-v1";
    if (values.schema_version !== expectedSchemaVersion) {
      addError("schema_version", "Unsupported row schema version.");
    }
    if (!values.entry_id || values.entry_id.length > 128) {
      addError("entry_id", "Entry ID is required and must be at most 128 characters.");
    } else if (seenIds.has(values.entry_id)) {
      addError("entry_id", "Entry ID is duplicated in this file.");
    } else {
      seenIds.add(values.entry_id);
    }

    const taxYear = parseYear(values.tax_year);
    if (taxYear === null) {
      addError("tax_year", "Tax year must be a four-digit year between 1900 and 2200.");
    } else if (expectedTaxYear !== undefined && taxYear !== expectedTaxYear) {
      addError("tax_year", `Row year does not match the selected year ${expectedTaxYear}.`);
    }

    if (!isIsoDate(values.occurred_on)) {
      addError("occurred_on", "Date must be a real calendar date in YYYY-MM-DD format.");
    } else if (taxYear !== null && Number(values.occurred_on.slice(0, 4)) !== taxYear) {
      addError("occurred_on", "Date must belong to the selected tax year.");
    }
    if (!ENTRY_TYPES.has(values.entry_type)) {
      addError("entry_type", "Entry type must be income or expense.");
    }
    if (!values.description.trim()) {
      addError("description", "Description is required.");
    } else if (values.description.length > 2000) {
      addError("description", "Description must be at most 2000 characters.");
    }
    if (values.category_code.length > 80) {
      addError("category_code", "Category code must be at most 80 characters.");
    }

    const amountCents = parsePositiveCents(values.amount_cents);
    if (amountCents === null) {
      addError("amount_cents", "Amount must be a positive integer number of cents.");
    }
    if (values.currency !== "EUR") {
      addError("currency", "This schema version accepts EUR only.");
    }
    const administrativeAmountCents = version === 1
      ? amountCents
      : parseNonNegativeCents(values.administrative_amount_cents);
    const internalOnlyCents = version === 1 ? 0 : parseNonNegativeCents(values.internal_only_cents);
    if (administrativeAmountCents === null) addError("administrative_amount_cents", "Administrative amount must be non-negative integer cents.");
    if (internalOnlyCents === null) addError("internal_only_cents", "Internal amount must be non-negative integer cents.");
    if (amountCents !== null && administrativeAmountCents !== null && internalOnlyCents !== null
      && administrativeAmountCents + internalOnlyCents !== amountCents) {
      addError("amount_cents", "Total amount must equal the administrative and internal shares.");
    }
    if (!STATUSES.has(values.review_status)) {
      addError("review_status", "Review status is not supported.");
    }

    for (const field of ["building_ref", "unit_ref", "document_ref"]) {
      if (values[field].length > 200) {
        addError(field, "Reference must be at most 200 characters.");
      }
    }

    if (errors.length === before) {
      rows.push({
        id: values.entry_id,
        taxYear,
        occurredOn: values.occurred_on,
        entryType: values.entry_type,
        description: values.description,
        categoryCode: values.category_code || null,
        amountCents,
        administrativeAmountCents,
        internalOnlyCents,
        currency: values.currency,
        buildingRef: values.building_ref || null,
        unitRef: values.unit_ref || null,
        documentRef: values.document_ref || null,
        reviewStatus: "needs_review",
        sourceReviewStatus: values.review_status,
      });
    }
  });

  return { delimiter, rows, errors, canImport: errors.length === 0 };
}

/** @param {string} text @returns {string} */
function detectDelimiter(text) {
  let commas = 0;
  let semicolons = 0;
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (!quoted && (char === "\r" || char === "\n")) {
      break;
    } else if (!quoted && char === ",") {
      commas += 1;
    } else if (!quoted && char === ";") {
      semicolons += 1;
    }
  }
  return semicolons >= commas ? ";" : ",";
}

/** @param {string} text @param {string} delimiter @returns {string[][]} */
function parseDelimitedText(text, delimiter) {
  const records = [];
  let record = [];
  let cell = "";
  let inQuotes = false;
  let afterQuote = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inQuotes) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
        afterQuote = true;
      } else if (char === "\r") {
        if (text[index + 1] === "\n") index += 1;
        cell += "\n";
      } else {
        cell += char;
      }
      continue;
    }

    if (afterQuote && char !== delimiter && char !== "\r" && char !== "\n") {
      throw new SyntaxError("Unexpected content after a quoted CSV field.");
    }
    if (char === delimiter) {
      record.push(cell);
      cell = "";
      afterQuote = false;
    } else if (char === '"') {
      if (cell !== "" || afterQuote) {
        throw new SyntaxError("Quote found inside an unquoted CSV field.");
      }
      inQuotes = true;
    } else if (char === "\r" || char === "\n") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      record.push(cell);
      records.push(record);
      record = [];
      cell = "";
      afterQuote = false;
    } else {
      cell += char;
    }
  }

  if (inQuotes) {
    throw new SyntaxError("CSV contains an unterminated quoted field.");
  }
  if (cell !== "" || record.length > 0 || afterQuote) {
    record.push(cell);
    records.push(record);
  }
  return records;
}

/** @param {unknown} cell */
function escapeCsvCell(cell) {
  const value = String(cell);
  // Quoting a cell does not prevent a spreadsheet from evaluating a formula.
  if (/^[\s\u0000-\u001f\u007f]*[=+\-@＝＋－＠]|^[\t\r\n]/u.test(value)) {
    throw new TypeError("CSV export contains a cell that could be evaluated as a formula.");
  }
  return /[;"\r\n]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/** @param {string[]} left @param {string[]} right */
function sameColumns(left, right) {
  return left.length === right.length && left.every((column, index) => column === right[index]);
}

/** @param {string} value */
function parseYear(value) {
  if (!/^\d{4}$/u.test(value)) return null;
  const year = Number(value);
  return year >= 1900 && year <= 2200 ? year : null;
}

/** @param {number} year */
function validateYear(year) {
  if (!Number.isInteger(year) || year < 1900 || year > 2200) {
    throw new RangeError("Year must be an integer between 1900 and 2200.");
  }
}

/** @param {string} value */
function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** @param {string} value */
function parsePositiveCents(value) {
  if (!/^\d+$/u.test(value)) return null;
  const cents = BigInt(value);
  return cents > 0n && cents <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(cents) : null;
}

/** @param {string} value */
function parseNonNegativeCents(value) {
  if (!/^\d+$/u.test(value)) return null;
  const cents = BigInt(value);
  return cents <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(cents) : null;
}

/** @param {object} entry */
function validateEntry(entry) {
  if (!entry || typeof entry.id !== "string" || entry.id.length === 0 || entry.id.length > 128) {
    throw new TypeError("Every ledger entry must have an ID of at most 128 characters.");
  }
  validateYear(entry.taxYear);
  if (!isIsoDate(entry.occurredOn)) {
    throw new TypeError("Entry date must be a real YYYY-MM-DD date.");
  }
  if (!ENTRY_TYPES.has(entry.entryType)) {
    throw new TypeError("Entry type must be income or expense.");
  }
  if (typeof entry.description !== "string" || !entry.description.trim() || entry.description.length > 2000) {
    throw new TypeError("Entry description must be non-empty text of at most 2000 characters.");
  }
  if (typeof entry.categoryCode !== "string" && entry.categoryCode !== undefined && entry.categoryCode !== null) {
    throw new TypeError("Category code must be text.");
  }
  if (!Number.isSafeInteger(entry.amountCents) || entry.amountCents <= 0) {
    throw new RangeError("Amount must be positive safe integer cents.");
  }
  const administrativeAmountCents = entry.administrativeAmountCents ?? entry.amountCents;
  const internalOnlyCents = entry.internalOnlyCents ?? 0;
  if (!Number.isSafeInteger(administrativeAmountCents) || administrativeAmountCents < 0
    || !Number.isSafeInteger(internalOnlyCents) || internalOnlyCents < 0
    || administrativeAmountCents + internalOnlyCents !== entry.amountCents) {
    throw new RangeError("Total amount must equal its administrative and internal shares.");
  }
  if (entry.currency !== "EUR") {
    throw new TypeError("This schema version accepts EUR only.");
  }
  if (entry.reviewStatus !== undefined && !STATUSES.has(entry.reviewStatus)) {
    throw new TypeError("Review status is not supported.");
  }
  for (const property of ["buildingRef", "unitRef", "documentRef"]) {
    const value = entry[property];
    if (value !== undefined && value !== null && (typeof value !== "string" || value.length > 200)) {
      throw new TypeError(`${property} must be text of at most 200 characters.`);
    }
  }
}
