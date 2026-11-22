/** @typedef {{ amountCents: number }} AmountRecord */

/**
 * Calculate the two-way settlement position for a mandatary's advances and
 * supplier payments. Amounts are positive integer cents; direction comes from
 * the record type. This is an operational reconciliation, not a tax decision.
 *
 * @param {{
 *   advances: AmountRecord[],
 *   reimbursements: AmountRecord[],
 *   supplierRefunds: AmountRecord[],
 *   returns: AmountRecord[],
 *   invoices: { id: string, totalCents: number }[],
 *   supplierPayments: (AmountRecord & { invoiceId: string | null })[],
 * }} ledger
 */
export function reconcileDebours(ledger) {
  if (!ledger || typeof ledger !== "object") {
    throw new TypeError("A debours ledger is required.");
  }

  const advances = validateAmounts(ledger.advances, "advances");
  const reimbursements = validateAmounts(ledger.reimbursements, "reimbursements");
  const supplierRefunds = validateAmounts(ledger.supplierRefunds, "supplier refunds");
  const returns = validateAmounts(ledger.returns, "returns");
  const invoices = validateInvoices(ledger.invoices);
  const supplierPayments = validatePayments(ledger.supplierPayments, invoices);

  const advancesAndReimbursementsCents = safeAdd(
    sumAmounts(advances),
    sumAmounts(reimbursements),
    "Advances and reimbursements",
  );
  const supplierPaymentsCents = sumAmounts(supplierPayments);
  const supplierRefundsCents = sumAmounts(supplierRefunds);
  const returnedToOwnerCents = sumAmounts(returns);
  const invoiceSupportedPaymentsCents = supplierPayments
    .filter(({ invoiceId }) => invoiceId !== null)
    .reduce((total, payment) => total + payment.amountCents, 0);
  const paymentsAwaitingInvoiceCents = supplierPayments
    .filter(({ invoiceId }) => invoiceId === null)
    .reduce((total, payment) => total + payment.amountCents, 0);

  const settlementCents = BigInt(advancesAndReimbursementsCents)
    + BigInt(supplierRefundsCents)
    - BigInt(supplierPaymentsCents)
    - BigInt(returnedToOwnerCents);
  const advanceAwaitingInvoiceCents = maxZeroAsSafeNumber(
    BigInt(advancesAndReimbursementsCents)
      + BigInt(supplierRefundsCents)
      - BigInt(returnedToOwnerCents)
      - BigInt(invoiceSupportedPaymentsCents),
    "Unsubstantiated advance",
  );

  return {
    advancesAndReimbursementsCents,
    supplierPaymentsCents,
    supplierRefundsCents,
    returnedToOwnerCents,
    invoiceSupportedPaymentsCents,
    paymentsAwaitingInvoiceCents,
    advanceAwaitingInvoiceCents,
    cashHeldCents: maxZeroAsSafeNumber(settlementCents, "Cash held"),
    ownerOwesMandataryCents: maxZeroAsSafeNumber(-settlementCents, "Owner balance due"),
    mandataryOwesOwnerCents: maxZeroAsSafeNumber(settlementCents, "Mandatary balance due"),
  };
}

/** @param {AmountRecord[]} records @param {string} label */
function validateAmounts(records, label) {
  if (!Array.isArray(records)) {
    throw new TypeError(`${label} must be an array.`);
  }
  for (const record of records) {
    if (!record || !Number.isSafeInteger(record.amountCents) || record.amountCents < 0) {
      throw new RangeError(`${label} amounts must be non-negative safe integer cents.`);
    }
  }
  return records;
}

/** @param {{ id: string, totalCents: number }[]} records */
function validateInvoices(records) {
  if (!Array.isArray(records)) {
    throw new TypeError("invoices must be an array.");
  }
  const invoices = new Map();
  for (const invoice of records) {
    if (!invoice || typeof invoice.id !== "string" || invoice.id.trim() === "") {
      throw new TypeError("Every invoice must have a non-empty ID.");
    }
    if (!Number.isSafeInteger(invoice.totalCents) || invoice.totalCents < 0) {
      throw new RangeError("Invoice totals must be non-negative safe integer cents.");
    }
    if (invoices.has(invoice.id)) {
      throw new TypeError(`Invoice ID ${invoice.id} is duplicated.`);
    }
    invoices.set(invoice.id, invoice.totalCents);
  }
  return invoices;
}

/** @param {(AmountRecord & { invoiceId: string | null })[]} records @param {Map<string, number>} invoices */
function validatePayments(records, invoices) {
  const payments = validateAmounts(records, "supplier payments");
  const allocatedByInvoice = new Map();
  for (const payment of payments) {
    if (payment.invoiceId === null) continue;
    if (typeof payment.invoiceId !== "string" || !invoices.has(payment.invoiceId)) {
      throw new TypeError("A supplier payment refers to an unknown invoice.");
    }
    const allocated = (allocatedByInvoice.get(payment.invoiceId) ?? 0) + payment.amountCents;
    if (allocated > invoices.get(payment.invoiceId)) {
      throw new RangeError("Supplier payments exceed the linked invoice total.");
    }
    allocatedByInvoice.set(payment.invoiceId, allocated);
  }
  return payments;
}

/** @param {AmountRecord[]} records */
function sumAmounts(records) {
  const total = records.reduce((sum, { amountCents }) => sum + amountCents, 0);
  if (!Number.isSafeInteger(total)) {
    throw new RangeError("Ledger total exceeds the safe integer range.");
  }
  return total;
}

/** @param {bigint} cents @param {string} label */
function maxZeroAsSafeNumber(cents, label) {
  const nonNegative = cents > 0n ? cents : 0n;
  if (nonNegative > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`${label} exceeds the safe integer range.`);
  }
  return Number(nonNegative);
}

/** @param {number} left @param {number} right @param {string} label */
function safeAdd(left, right, label) {
  const total = BigInt(left) + BigInt(right);
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`${label} exceeds the safe integer range.`);
  }
  return Number(total);
}
