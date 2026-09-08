/**
 * One table-header treatment for the whole app.
 *
 * Four had grown in parallel — a navy-tinted header with an accent bar, the
 * same tint without the bar, a solid inverted navy, and plain default — with
 * ManagerDashboard using two of them itself. Import these rather than writing
 * the classes again.
 */

export const tableHeaderClass = "bg-navy/5";
export const tableHeaderRowClass = "hover:bg-navy/5 border-b";
export const tableHeadCellClass = "text-navy font-semibold";

/** Sits directly above a table to carry the header's colour to the card edge. */
export const TableAccentBar = () => <div className="h-1 w-full bg-navy" />;
