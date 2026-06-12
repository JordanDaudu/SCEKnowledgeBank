import { afterAll, describe, expect, it } from "vitest";
import { db } from "@workspace/db";
import {
  createCourse,
  updateCourse,
  deleteCourse,
} from "./taxonomy.service";

const SX = `_tax_${Date.now().toString(36)}`;
const CODE = `TST${SX}`.slice(0, 32);
const createdIds: string[] = [];

afterAll(async () => {
  await db.course.deleteMany({ where: { id: { in: createdIds } } });
});

describe("taxonomy.service createCourse", () => {
  it("creates a course and trims its fields", async () => {
    const course = await createCourse({
      code: `  ${CODE}  `,
      title: "  Intro to Testing  ",
      lecturerName: "  Dr. Vitest  ",
    });
    createdIds.push(course.id);

    expect(course).toMatchObject({
      code: CODE,
      title: "Intro to Testing",
      lecturerName: "Dr. Vitest",
    });
    const row = await db.course.findUnique({ where: { id: course.id } });
    expect(row?.code).toBe(CODE);
  });

  it("rejects a duplicate course code with a 409 conflict", async () => {
    await expect(
      createCourse({
        code: CODE,
        title: "Another title",
        lecturerName: "Someone else",
      }),
    ).rejects.toMatchObject({ status: 409, code: "conflict" });
  });

  it("updates an existing course and trims fields", async () => {
    const created = await createCourse({
      code: `${CODE}U`.slice(0, 32),
      title: "Before",
      lecturerName: "Before Lecturer",
    });
    createdIds.push(created.id);

    const updated = await updateCourse(created.id, { title: "  After  " });
    expect(updated.title).toBe("After");
    expect(updated.code).toBe(created.code); // unchanged
  });

  it("404s when updating a course that does not exist", async () => {
    await expect(
      updateCourse("00000000-0000-0000-0000-000000000000", { title: "x" }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("deletes a course, after which it is gone", async () => {
    const created = await createCourse({
      code: `${CODE}D`.slice(0, 32),
      title: "To delete",
      lecturerName: "Temp",
    });
    await deleteCourse(created.id);
    const row = await db.course.findUnique({ where: { id: created.id } });
    expect(row).toBeNull();
    await expect(deleteCourse(created.id)).rejects.toMatchObject({ status: 404 });
  });
});
