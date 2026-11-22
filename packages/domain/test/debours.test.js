import assert from "node:assert/strict";
import test from "node:test";
import { formatEuroCents, parseEuroToCents } from "../src/money.js";
import { reconcileDebours } from "../src/reconcile-debours.js";

test("parseEuroToCents reads French currency strings without floating point", () => {
  assert.equal(parseEuroToCents("1 234,56 €"), 123456);
  assert.equal(parseEuroToCents("1\u202f234,5"), 123450);
  assert.equal(parseEuroToCents("1234.56"), 123456);
  assert.equal(parseEuroToCents("1.234,56 €"), 123456);
  assert.equal(parseEuroToCents("1,234.56"), 123456);
});

test("parseEuroToCents rejects ambiguous, negative and over-precise amounts", () => {
  for (const amount of ["", "-1,00", "1,234", "1.234", "1,234,56", "12,3456", "un euro", "1 2,50", "12, 50", "1\t234"]) {
    assert.throws(() => parseEuroToCents(amount), { name: "TypeError" }, amount);
  }
});

test("formatEuroCents formats integer cents without floating-point conversion", () => {
  assert.equal(formatEuroCents(123456), "1\u202f234,56\u00a0€");
  assert.equal(formatEuroCents(-7), "-0,07\u00a0€");
  assert.throws(() => formatEuroCents(Number.NaN), { name: "TypeError" });
});

test("reconcileDebours reports an unused advance awaiting supporting invoices", () => {
  const result = reconcileDebours({
    advances: [{ amountCents: 50000 }],
    invoices: [],
    supplierPayments: [],
    supplierRefunds: [],
    reimbursements: [],
    returns: [],
  });

  assert.deepEqual(result, {
    advancesAndReimbursementsCents: 50000,
    supplierPaymentsCents: 0,
    supplierRefundsCents: 0,
    returnedToOwnerCents: 0,
    invoiceSupportedPaymentsCents: 0,
    paymentsAwaitingInvoiceCents: 0,
    advanceAwaitingInvoiceCents: 50000,
    cashHeldCents: 50000,
    ownerOwesMandataryCents: 0,
    mandataryOwesOwnerCents: 50000,
  });
});

test("partial invoice payment reconciles only the paid share of the advance", () => {
  const result = reconcileDebours({
    advances: [{ amountCents: 10000 }],
    invoices: [{ id: "inv-1", totalCents: 8000 }],
    supplierPayments: [{ amountCents: 3000, invoiceId: "inv-1" }],
    supplierRefunds: [],
    reimbursements: [],
    returns: [],
  });

  assert.equal(result.invoiceSupportedPaymentsCents, 3000);
  assert.equal(result.advanceAwaitingInvoiceCents, 7000);
  assert.equal(result.mandataryOwesOwnerCents, 7000);
});

test("reconcileDebours shows what the owner owes when the mandatary paid more", () => {
  const result = reconcileDebours({
    advances: [],
    invoices: [{ id: "inv-1", totalCents: 12000 }],
    supplierPayments: [{ amountCents: 12000, invoiceId: "inv-1" }],
    supplierRefunds: [],
    reimbursements: [{ amountCents: 2500 }],
    returns: [],
  });

  assert.equal(result.ownerOwesMandataryCents, 9500);
  assert.equal(result.mandataryOwesOwnerCents, 0);
  assert.equal(result.advanceAwaitingInvoiceCents, 0);
});

test("reconcileDebours keeps payments without an invoice visible as unsupported", () => {
  const result = reconcileDebours({
    advances: [{ amountCents: 8000 }],
    invoices: [],
    supplierPayments: [{ amountCents: 2500, invoiceId: null }],
    supplierRefunds: [],
    reimbursements: [],
    returns: [],
  });

  assert.equal(result.paymentsAwaitingInvoiceCents, 2500);
  assert.equal(result.advanceAwaitingInvoiceCents, 8000);
  assert.equal(result.cashHeldCents, 5500);
});

test("reconcileDebours rejects payments above the linked invoice and invalid cents", () => {
  assert.throws(() => reconcileDebours({
    advances: [],
    invoices: [{ id: "inv-1", totalCents: 1000 }],
    supplierPayments: [{ amountCents: 1001, invoiceId: "inv-1" }],
    supplierRefunds: [],
    reimbursements: [],
    returns: [],
  }), { name: "RangeError" });

  assert.throws(() => reconcileDebours({
    advances: [{ amountCents: -1 }],
    invoices: [],
    supplierPayments: [],
    supplierRefunds: [],
    reimbursements: [],
    returns: [],
  }), { name: "RangeError" });
});

test("reconcileDebours accounts for supplier refunds and returned funds", () => {
  const result = reconcileDebours({
    advances: [{ amountCents: 10000 }],
    invoices: [{ id: "inv-1", totalCents: 7000 }],
    supplierPayments: [{ amountCents: 7000, invoiceId: "inv-1" }],
    supplierRefunds: [{ amountCents: 1000 }],
    reimbursements: [],
    returns: [{ amountCents: 2000 }],
  });

  assert.equal(result.cashHeldCents, 2000);
  assert.equal(result.advanceAwaitingInvoiceCents, 2000);
  assert.equal(result.mandataryOwesOwnerCents, 2000);
});

test("reconcileDebours rejects invoice over-allocation and totals beyond safe cents", () => {
  assert.throws(() => reconcileDebours({
    advances: [],
    invoices: [{ id: "inv-1", totalCents: 1000 }],
    supplierPayments: [
      { amountCents: 700, invoiceId: "inv-1" },
      { amountCents: 301, invoiceId: "inv-1" },
    ],
    supplierRefunds: [],
    reimbursements: [],
    returns: [],
  }), { name: "RangeError" });

  assert.throws(() => reconcileDebours({
    advances: [{ amountCents: Number.MAX_SAFE_INTEGER }],
    invoices: [],
    supplierPayments: [],
    supplierRefunds: [],
    reimbursements: [{ amountCents: 1 }],
    returns: [],
  }), { name: "RangeError" });
});
