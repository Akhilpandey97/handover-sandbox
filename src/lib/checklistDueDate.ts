/**
 * Due date for a checklist item: the project's kick-off plus the template's
 * standard duration.
 *
 * Mirrors the `seed_project_checklist()` trigger, which applies the same rule
 * when a project is created. Keep the two in step — this is the app-side path
 * for items added to projects that already exist, which the trigger never sees.
 */
export const checklistDueDate = (
  kickOffDate: string | null | undefined,
  standardDuration: number | null | undefined,
): string | null => {
  if (!kickOffDate || !standardDuration || standardDuration <= 0) return null;
  const date = new Date(kickOffDate);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + standardDuration);
  return date.toISOString().slice(0, 10);
};
