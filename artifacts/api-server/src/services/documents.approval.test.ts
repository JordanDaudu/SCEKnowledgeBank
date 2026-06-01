import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@workspace/db";
import type { AuthenticatedUser } from "../middlewares/auth";
import {
  uploadDocuments,
  approveDocument,
  adminApproveDocument,
  rejectDocument,
  listPendingAdminApproval,
} from "./documents.service";

const SX = `_appr_${Date.now().toString(36)}`;
let courseId: string;
let lecturerId: string;
let studentId: string;
let adminId: string;

function authed(
  id: string,
  role: string,
  enroll: { courseId: string; roleInCourse: string }[] = [],
): AuthenticatedUser {
  return {
    id, email: `${id}@demo`, displayName: id, isActive: true,
    primaryRole: role, roles: [role], enrollments: enroll,
    username: null, avatarStoragePath: null, createdAt: new Date().toISOString(),
  };
}
function file(name: string, mime: string) {
  // Unique bytes per file so the upload dedup short-circuit never collapses
  // two test docs. PDFs keep the %PDF magic so the content sniffer passes.
  const body = (mime === "application/pdf" ? "%PDF-1.4 " : "bin ") + name + SX;
  return {
    fieldname: "files", originalname: name, encoding: "7bit", mimetype: mime,
    size: body.length, buffer: Buffer.from(body),
    stream: null as never, destination: "", filename: name, path: "",
  } as Express.Multer.File;
}
const lec = () => authed(lecturerId, "lecturer", [{ courseId, roleInCourse: "lecturer" }]);

beforeAll(async () => {
  const adminRole = (await db.role.findFirst({ where: { name: "admin" } }))
    ?? (await db.role.create({ data: { name: "admin" } }));
  const c = await db.course.create({ data: { code: `AP${SX}`.slice(0, 20), title: "Appr", lecturerName: "L" } });
  courseId = c.id;
  const l = await db.user.create({ data: { email: `l${SX}@demo`, passwordHash: "x", displayName: "L" } });
  const s = await db.user.create({ data: { email: `s${SX}@demo`, passwordHash: "x", displayName: "S" } });
  const a = await db.user.create({ data: { email: `a${SX}@demo`, passwordHash: "x", displayName: "A", primaryRoleId: adminRole.id } });
  await db.userRole.create({ data: { userId: a.id, roleId: adminRole.id } });
  lecturerId = l.id; studentId = s.id; adminId = a.id;
  await db.courseEnrollment.create({ data: { userId: l.id, courseId, roleInCourse: "lecturer" } });
});

afterAll(async () => {
  await db.document.deleteMany({ where: { uploaderId: { in: [lecturerId, studentId, adminId] } } });
  await db.notification.deleteMany({ where: { recipientId: { in: [lecturerId, adminId] } } });
  await db.auditLog.deleteMany({ where: { actorUserId: { in: [lecturerId, studentId, adminId] } } });
  await db.courseEnrollment.deleteMany({ where: { courseId } });
  await db.userRole.deleteMany({ where: { userId: adminId } });
  await db.user.deleteMany({ where: { id: { in: [lecturerId, studentId, adminId] } } });
  await db.course.deleteMany({ where: { id: courseId } });
});

const base = { categoryId: undefined, materialType: "lecture-notes", description: "", tagIds: [] as string[] };

describe("approval overhaul", () => {
  it("student upload (not enrolled) → pending_review + notifies lecturers", async () => {
    const [r] = await uploadDocuments({ ...base, files: [file("notes.pdf", "application/pdf")], visibility: "public", courseId }, authed(studentId, "student"));
    expect(r.success).toBe(true);
    expect(r.document!.status).toBe("pending_review");
    const notif = await db.notification.findFirst({ where: { recipientId: lecturerId, type: "document.review_requested" } });
    expect(notif).not.toBeNull();
  });

  it("lecturer normal → published; restricted → pending_admin_approval + notifies admins", async () => {
    const [n] = await uploadDocuments({ ...base, files: [file("deck.pdf", "application/pdf")], visibility: "public", courseId }, lec());
    expect(n.document!.status).toBe("published");
    const [z] = await uploadDocuments({ ...base, files: [file("bundle.zip", "application/zip")], visibility: "public", courseId }, lec());
    expect(z.document!.status).toBe("pending_admin_approval");
    const notif = await db.notification.findFirst({ where: { recipientId: adminId, type: "document.admin_review_requested" } });
    expect(notif).not.toBeNull();
  });

  it("approve: normal student doc → approved; restricted → pending_admin then admin-approve → approved", async () => {
    const [normal] = await uploadDocuments({ ...base, files: [file("hw.pdf", "application/pdf")], visibility: "public", courseId }, authed(studentId, "student"));
    expect((await approveDocument(normal.document!.id, lec())).status).toBe("approved");

    const [restricted] = await uploadDocuments({ ...base, files: [file("proj.zip", "application/zip")], visibility: "public", courseId }, authed(studentId, "student"));
    expect((await approveDocument(restricted.document!.id, lec())).status).toBe("pending_admin_approval");
    expect((await adminApproveDocument(restricted.document!.id, authed(adminId, "admin"))).status).toBe("approved");
  });

  it("adminApproveDocument rejects non-admins", async () => {
    const [d] = await uploadDocuments({ ...base, files: [file("x.zip", "application/zip")], visibility: "public", courseId }, lec());
    await expect(adminApproveDocument(d.document!.id, lec())).rejects.toMatchObject({ status: 403 });
  });

  it("reject works from pending_admin_approval (admin) and pending_review (lecturer)", async () => {
    const [d] = await uploadDocuments({ ...base, files: [file("y.zip", "application/zip")], visibility: "public", courseId }, lec());
    expect((await rejectDocument(d.document!.id, "not allowed", authed(adminId, "admin"))).status).toBe("rejected");
    const [s] = await uploadDocuments({ ...base, files: [file("z.pdf", "application/pdf")], visibility: "public", courseId }, authed(studentId, "student"));
    expect((await rejectDocument(s.document!.id, "needs work", lec())).status).toBe("rejected");
  });

  it("listPendingAdminApproval is admin-only", async () => {
    await expect(listPendingAdminApproval(lec(), { page: 1, pageSize: 20 })).rejects.toMatchObject({ status: 403 });
    const page = await listPendingAdminApproval(authed(adminId, "admin"), { page: 1, pageSize: 20 });
    expect(Array.isArray(page.items)).toBe(true);
  });
});
