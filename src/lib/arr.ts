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

/** "12.3" or "12" (Crores, no unit suffix) — trims unnecessary decimals */
export const arrCroreValue = (value: number | null | undefined, digits = 2): string => {
  const cr = arrToCrore(value);
  if (digits === 2) {
    // Use 1 decimal unless the value is a whole number
    const d = cr % 1 === 0 ? 0 : 1;
    return cr.toFixed(d);
  }
  return cr.toFixed(digits);
};

/** "12.3 Cr" */
export const formatArrCr = (value: number | null | undefined, digits = 2): string =>
  `${arrCroreValue(value, digits)} Cr`;

/** Sum a list of raw ARR values and return Crores. */
export const sumArrCrore = (values: Array<number | null | undefined>): number =>
  values.reduce<number>((sum, v) => sum + arrToCrore(v), 0);

/**
 * Format a value that is ALREADY in Crores (e.g. the output of sumArrCrore).
 * Does NOT call arrToCrore — avoids double-conversion when the total exceeds
 * the 1-lakh threshold that arrToCrore uses to detect raw-rupee values.
 */
export const formatCr = (crores: number | null | undefined, digits = 2): string => {
  const n = Number(crores ?? 0);
  if (!Number.isFinite(n)) return "0";
  if (digits === 2) {
    const d = n % 1 === 0 ? 0 : 1;
    return n.toFixed(d);
  }
  return n.toFixed(digits);
};
