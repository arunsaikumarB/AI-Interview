/**
 * F-03 / JOBS-05 regression — editing a Job must never clear its Department.
 *
 * Original defect: the department <select> was uncontrolled with
 * defaultValue={initial.departmentId}, while the department list was fetched
 * asynchronously from /api/org. React applies defaultValue only on the first
 * render — at which point departments is still [] and no matching <option>
 * exists — so the select settled on the empty placeholder. Every subsequent
 * save posted departmentId: null and silently wiped the department, even when
 * the user had only edited the title.
 *
 * These tests pin the three properties that make that impossible:
 *   1. the initial value comes from the job, not from the loaded list;
 *   2. the selected department always has an <option>, including mid-load;
 *   3. an untouched selection submits the original id, never null.
 *
 *   npx tsx --test tests/unit/job-form-department.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  departmentIdForSubmit,
  departmentSelectOptions,
  initialDepartmentValue,
} from "../../src/lib/jobs/department-select";

const ENGINEERING = { id: "cmsp3apq400022ezwtoop8hor", name: "Engineering" };
const PEOPLE = { id: "cmsp3apqb00042ezweqkppys7", name: "People" };
const LOADED = [ENGINEERING, PEOPLE];

describe("job form department selection", () => {
  it("takes its initial value from the job, before departments load", () => {
    assert.equal(
      initialDepartmentValue({ departmentId: ENGINEERING.id }),
      ENGINEERING.id,
    );
  });

  it("treats a job with no department as the empty placeholder", () => {
    assert.equal(initialDepartmentValue({ departmentId: null }), "");
    assert.equal(initialDepartmentValue(undefined), "");
  });

  it("keeps an option for the current department while the list is still empty", () => {
    const options = departmentSelectOptions([], ENGINEERING.id, ENGINEERING.name);

    assert.equal(options.length, 1);
    assert.equal(options[0].id, ENGINEERING.id);
    assert.equal(options[0].name, "Engineering");
  });

  it("falls back to a neutral label when the department name is unknown", () => {
    const options = departmentSelectOptions([], ENGINEERING.id, null);

    assert.equal(options[0].id, ENGINEERING.id);
    assert.equal(options[0].name, "Current department");
  });

  it("does not duplicate the department once the list has loaded", () => {
    const options = departmentSelectOptions(LOADED, ENGINEERING.id, ENGINEERING.name);

    assert.deepEqual(options, LOADED);
    assert.equal(options.filter((d) => d.id === ENGINEERING.id).length, 1);
  });

  it("leaves the list untouched when no department is selected", () => {
    assert.deepEqual(departmentSelectOptions(LOADED, ""), LOADED);
    assert.deepEqual(departmentSelectOptions([], ""), []);
  });

  it("REGRESSION: existing department + edit another field -> department unchanged", () => {
    // Job being edited already belongs to Engineering.
    const job = { departmentId: ENGINEERING.id, departmentName: ENGINEERING.name };

    // Mount: departments have NOT arrived yet (the exact JOBS-05 window).
    let selected = initialDepartmentValue(job);
    let options = departmentSelectOptions([], selected, job.departmentName);
    assert.ok(
      options.some((d) => d.id === selected),
      "selection must be renderable before the department list loads",
    );

    // The user edits only the title. The department control is never touched,
    // so its state does not change.
    const editedTitle = "TEST — Senior Full Stack Engineer (renamed)";

    // /api/org resolves mid-edit and re-renders with the full list.
    options = departmentSelectOptions(LOADED, selected, job.departmentName);
    assert.ok(options.some((d) => d.id === selected));

    // Save.
    const payload = {
      title: editedTitle,
      departmentId: departmentIdForSubmit(selected),
    };

    assert.equal(
      payload.departmentId,
      ENGINEERING.id,
      "editing the title must not clear the department",
    );
    assert.notEqual(payload.departmentId, null);
  });

  it("still allows a deliberate clear to null", () => {
    // User actively picks the "—" placeholder.
    assert.equal(departmentIdForSubmit(""), null);
    assert.equal(departmentIdForSubmit("   "), null);
  });

  it("submits a deliberate change to another department", () => {
    assert.equal(departmentIdForSubmit(PEOPLE.id), PEOPLE.id);
  });
});
