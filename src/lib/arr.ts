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

/** "12.34" (Crores, no unit suffix) */
export const arrCroreValue = (value: number | null | undefined, digits = 2): string =>
  arrToCrore(value).toFixed(digits);

/** "12.34 Cr" */
export const formatArrCr = (value: number | null | undefined, digits = 2): string =>
  `${arrCroreValue(value, digits)} Cr`;

/** Sum a list of raw ARR values and return Crores. */
export const sumArrCrore = (values: Array<number | null | undefined>): number =>
  values.reduce<number>((sum, v) => sum + arrToCrore(v), 0);
