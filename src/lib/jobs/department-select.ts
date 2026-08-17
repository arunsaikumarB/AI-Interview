/**
 * Department <select> state for the Job form.
 *
 * Kept as pure functions (no React, no DOM) so the behaviour that broke in
 * JOBS-05 is directly testable: the department list arrives from /api/org
 * asynchronously, so on first render the job's own department has no matching
 * <option>. An uncontrolled select silently falls back to the empty
 * placeholder, and the next save posts departmentId: null — clearing the
 * department even when the user only edited the title.
 */

export type DepartmentOption = { id: string; name: string };

export type JobDepartmentInitial = {
  departmentId?: string | null;
  departmentName?: string | null;
} | null | undefined;

/**
 * The value the select must hold before anything has loaded. Derived from the
 * job itself, never from the (possibly empty) department list.
 */
export function initialDepartmentValue(initial: JobDepartmentInitial): string {
  return initial?.departmentId ?? "";
}

/**
 * Options to render, guaranteeing the currently selected department is always
 * present. A <select> cannot hold a value that no <option> carries, so without
 * this the selection is lost for the whole window between first paint and the
 * department list arriving.
 */
export function departmentSelectOptions(
  departments: DepartmentOption[],
  selectedId: string,
  selectedName?: string | null,
): DepartmentOption[] {
  if (!selectedId) return departments;
  if (departments.some((d) => d.id === selectedId)) return departments;
  return [
    { id: selectedId, name: selectedName?.trim() || "Current department" },
    ...departments,
  ];
}

/**
 * What the save request should carry. Empty string means the user explicitly
 * chose "no department"; null is the wire format the API expects for that.
 */
export function departmentIdForSubmit(selectedId: string): string | null {
  return selectedId.trim() || null;
}
