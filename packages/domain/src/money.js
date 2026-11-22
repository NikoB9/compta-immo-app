const EURO_SUFFIX = /\s*€\s*$/u;
const GROUPED_INTEGER = /^\d{1,3}(?:[.,]\d{3})+$/u;
const PLAIN_INTEGER = /^\d+$/u;

/**
 * Parse a user-entered euro amount into integer cents.
 * Group separators are supported only when they form valid groups of three.
 * Ambiguous or over-precise values are rejected instead of rounded.
 *
 * @param {string} input
 * @returns {number}
 */
export function parseEuroToCents(input) {
  if (typeof input !== "string") {
    throw new TypeError("Amount must be entered as text.");
  }

  let value = input.trim().replace(EURO_SUFFIX, "");
  if (/[\s]/u.test(value)) {
    if (!/^\d{1,3}(?:[ \u00a0\u202f]\d{3})+(?:[.,]\d{1,2})?$/u.test(value)) {
      throw new TypeError("Amount has invalid digit grouping.");
    }
    value = value.replace(/[ \u00a0\u202f]/gu, "");
  }

  if (!value || value.startsWith("-") || value.startsWith("+")) {
    throw new TypeError("Amount must be a non-negative euro value.");
  }

  const separators = [...value.matchAll(/[.,]/gu)].map((match) => ({
    symbol: match[0],
    index: match.index,
  }));

  let whole;
  let fraction = "";

  if (separators.length === 0) {
    if (!PLAIN_INTEGER.test(value)) {
      throw new TypeError("Amount is not a valid euro value.");
    }
    whole = value;
  } else if (new Set(separators.map(({ symbol }) => symbol)).size === 2) {
    const decimalSeparator = separators.at(-1)?.symbol;
    const groupSeparator = decimalSeparator === "," ? "." : ",";
    const decimalIndex = value.lastIndexOf(decimalSeparator);
    const groupedWhole = value.slice(0, decimalIndex);
    fraction = value.slice(decimalIndex + 1);

    if (!GROUPED_INTEGER.test(groupedWhole) || groupedWhole.includes(decimalSeparator)) {
      throw new TypeError("Amount has invalid digit grouping.");
    }
    whole = groupedWhole.split(groupSeparator).join("");
  } else {
    const separator = separators[0]?.symbol;
    const count = separators.length;
    if (count > 1) {
      if (separators.some(({ symbol }) => symbol !== separator) || !GROUPED_INTEGER.test(value)) {
        throw new TypeError("Amount has invalid digit grouping.");
      }
      whole = value.split(separator).join("");
    } else {
      const [integerPart, decimalPart] = value.split(separator);
      if (!integerPart || !PLAIN_INTEGER.test(integerPart)) {
        throw new TypeError("Amount is not a valid euro value.");
      }
      whole = integerPart;
      fraction = decimalPart ?? "";
    }
  }

  if (!/^\d{1,2}$/u.test(fraction) && fraction !== "") {
    throw new TypeError("Amount can have at most two decimal places.");
  }
  if (fraction === "" && separators.length > 0) {
    throw new TypeError("Amount must have digits after its decimal separator.");
  }

  const cents = BigInt(whole) * 100n + BigInt((fraction + "00").slice(0, 2));
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError("Amount is too large to represent safely in cents.");
  }
  return Number(cents);
}

/**
 * @param {number} cents
 * @returns {string}
 */
export function formatEuroCents(cents) {
  if (!Number.isSafeInteger(cents)) {
    throw new TypeError("Amount must be a safe integer number of cents.");
  }

  const absoluteCents = BigInt(Math.abs(cents));
  const euros = absoluteCents / 100n;
  const remainder = (absoluteCents % 100n).toString().padStart(2, "0");
  const groupedEuros = new Intl.NumberFormat("fr-FR", {
    maximumFractionDigits: 0,
  }).format(euros);
  const sign = cents < 0 ? "-" : "";
  return `${sign}${groupedEuros},${remainder}\u00a0€`;
}
