/**
 * ARR helpers.
 *
 * ARR is stored in raw rupees for imported/synced data, but some legacy rows
 * were entered directly in Crores. Anything at or above 1 lakh is treated as
 * rupees; smaller values are assumed to already be Crores.
 */
export const arrToCrore = (value: number | null | undefined): number => {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.abs(n) >= 100000 ? n / 1e7 : n;
};

/** Indian number format: values < 1 Cr display as Lakhs ("5 L"), ≥ 1 Cr as Crores ("1.5 Cr"). */
const formatIndian = (crores: number): string => {
  if (crores === 0) return "0";
  if (Math.abs(crores) < 1) {
    const lakhs = crores * 100;
    const d = Math.abs(lakhs) % 1 === 0 ? 0 : 1;
    return `${lakhs.toFixed(d)} L`;
  }
  const d = Math.abs(crores) % 1 === 0 ? 0 : 1;
  return `${crores.toFixed(d)} Cr`;
};

/** Returns the numeric Crore value as a string — for computations that need a number string, not display. */
export const arrCroreValue = (value: number | null | undefined, digits = 2): string => {
  const cr = arrToCrore(value);
  if (digits === 2) {
    const d = cr % 1 === 0 ? 0 : 1;
    return cr.toFixed(d);
  }
  return cr.toFixed(digits);
};

/** "5 L" or "1.5 Cr" — converts raw/legacy ARR value then formats with Indian units. */
export const formatArrCr = (value: number | null | undefined): string =>
  formatIndian(arrToCrore(value));

/** Sum a list of raw ARR values and return Crores. */
export const sumArrCrore = (values: Array<number | null | undefined>): number =>
  values.reduce<number>((sum, v) => sum + arrToCrore(v), 0);

/**
 * Format a value that is ALREADY in Crores (e.g. the output of sumArrCrore).
 * Returns "5 L" or "1.5 Cr" — does NOT call arrToCrore to avoid double-conversion.
 */
export const formatCr = (crores: number | null | undefined): string => {
  const n = Number(crores ?? 0);
  if (!Number.isFinite(n)) return "0";
  return formatIndian(n);
};

/**
 * Format a crore value as full Indian rupees with ₹ symbol and Indian comma grouping.
 * e.g. 1.5 Cr → ₹1,50,00,000
 */
export const formatIndianRupees = (crores: number | null | undefined): string => {
  const n = Number(crores ?? 0);
  if (!Number.isFinite(n)) return "₹0";
  const rupees = Math.round(n * 1e7);
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(rupees);
};
