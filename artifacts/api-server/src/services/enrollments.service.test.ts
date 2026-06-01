import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@workspace/db";
import type { AuthenticatedUser } from "../middlewares/auth";
import { listMyCourses, addMyCourse, removeMyCourse } from "./enrollments.service";
import { listCourses } from "./taxonomy.service";

const SX = `_enr_${Date.now().toString(36)}`;
let studentId: string;
let lecturerId: string;
let adminId: string;
let courseAId: string;
let courseBId: string;

function authed(id: string, primaryRole: string): AuthenticatedUser {
  return {
    id, email: `${id}@demo`, displayName: id, isActive: true,
    primaryRole, roles: [primaryRole], enrollments: [],
    username: null, avatarStoragePath: null, createdAt: new Date().toISOString(),
  };
}

beforeAll(async () => {
  const s = await db.user.create({ data: { email: `s${SX}@demo`, passwordHash: "x", displayName: "S" } });
  const l = await db.user.create({ data: { email: `l${SX}@demo`, passwordHash: "x", displayName: "L" } });
  const a = await db.user.create({ data: { email: `a${SX}@demo`, passwordHash: "x", displayName: "A" } });
  studentId = s.id; lecturerId = l.id; adminId = a.id;
  const ca = await db.course.create({ data: { code: `AA${SX}`.slice(0, 20), title: "Alpha", lecturerName: "X" } });
  const cb = await db.course.create({ data: { code: `BB${SX}`.slice(0, 20), title: "Beta", lecturerName: "Y" } });
  courseAId = ca.id; courseBId = cb.id;
});

afterAll(async () => {
  await db.courseEnrollment.deleteMany({ where: { userId: { in: [studentId, lecturerId, adminId] } } });
  await db.auditLog.deleteMany({ where: { actorUserId: { in: [studentId, lecturerId, adminId] } } });
  await db.course.deleteMany({ where: { id: { in: [courseAId, courseBId] } } });
  await db.user.deleteMany({ where: { id: { in: [studentId, lecturerId, adminId] } } });
});

describe("enrollments.service", () => {
  it("addMyCourse derives roleInCourse=student for a student + audits", async () => {
    const list = await addMyCourse(authed(studentId, "student"), courseAId);
    expect(list.find((c) => c.id === courseAId)?.roleInCourse).toBe("student");
    const row = await db.courseEnrollment.findFirst({ where: { userId: studentId, courseId: courseAId } });
    expect(row?.roleInCourse).toBe("student");
    const audit = await db.auditLog.findFirst({ where: { actorUserId: studentId, action: "user.course_added" } });
    expect(audit).not.toBeNull();
  });

  it("addMyCourse derives roleInCourse=lecturer for a lecturer", async () => {
    const list = await addMyCourse(authed(lecturerId, "lecturer"), courseAId);
    expect(list.find((c) => c.id === courseAId)?.roleInCourse).toBe("lecturer");
  });

  it("addMyCourse is idempotent", async () => {
    await addMyCourse(authed(studentId, "student"), courseBId);
    await addMyCourse(authed(studentId, "student"), courseBId);
    const n = await db.courseEnrollment.count({ where: { userId: studentId, courseId: courseBId } });
    expect(n).toBe(1);
  });

  it("addMyCourse rejects admins with 403", async () => {
    await expect(addMyCourse(authed(adminId, "admin"), courseAId)).rejects.toMatchObject({ status: 403 });
  });

  it("addMyCourse rejects an unknown course with 404", async () => {
    await expect(
      addMyCourse(authed(studentId, "student"), "00000000-0000-0000-0000-000000000000"),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("listMyCourses returns joined details sorted by code", async () => {
    const list = await listMyCourses(authed(studentId, "student"));
    const codes = list.map((c) => c.code);
    expect(codes).toEqual([...codes].sort());
    expect(list.every((c) => c.title.length > 0)).toBe(true);
  });

  it("removeMyCourse deletes the enrollment + audits; non-enrollment is a no-op", async () => {
    await removeMyCourse(authed(studentId, "student"), courseAId);
    const row = await db.courseEnrollment.findFirst({ where: { userId: studentId, courseId: courseAId } });
    expect(row).toBeNull();
    await expect(removeMyCourse(authed(studentId, "student"), courseAId)).resolves.toBeInstanceOf(Array);
  });
});

describe("taxonomy.listCourses search", () => {
  it("filters by case-insensitive q over code/title", async () => {
    const byTitle = await listCourses({ q: "alph" });
    expect(byTitle.some((c) => c.id === courseAId)).toBe(true);
    expect(byTitle.some((c) => c.id === courseBId)).toBe(false);
  });
  it("returns all courses when q is omitted", async () => {
    const all = await listCourses();
    expect(all.some((c) => c.id === courseAId)).toBe(true);
    expect(all.some((c) => c.id === courseBId)).toBe(true);
  });
});
