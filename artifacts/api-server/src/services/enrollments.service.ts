import * as enrollmentsRepo from "../repositories/enrollments.repo";
import * as taxonomyRepo from "../repositories/taxonomy.repo";
import * as taxonomyService from "./taxonomy.service";
import * as auditService from "./audit.service";
import { forbidden, notFound } from "../lib/errors";
import type { AuthenticatedUser } from "../middlewares/auth";

export interface MyCourse {
  id: string;
  code: string;
  title: string;
  lecturerName: string;
  roleInCourse: string;
}

/** Course role is derived from the user's global role — never client-supplied.
 *  A student can only ever create a student-enrollment; only a lecturer creates
 *  a lecturer-enrollment. Admins do not self-manage courses. */
function roleInCourseFor(user: AuthenticatedUser): "student" | "lecturer" {
  if (user.primaryRole === "student") return "student";
  if (user.primaryRole === "lecturer") return "lecturer";
  throw forbidden("Only students and lecturers can manage course membership.");
}

export async function listMyCourses(user: AuthenticatedUser): Promise<MyCourse[]> {
  const enrollments = await enrollmentsRepo.findEnrollmentsForUser(user.id);
  const courses = await taxonomyService.loadCourses(enrollments.map((e) => e.courseId));
  const out: MyCourse[] = [];
  for (const e of enrollments) {
    const c = courses.get(e.courseId);
    if (c) {
      out.push({
        id: c.id,
        code: c.code,
        title: c.title,
        lecturerName: c.lecturerName,
        roleInCourse: e.roleInCourse,
      });
    }
  }
  out.sort((a, b) => a.code.localeCompare(b.code));
  return out;
}

export async function addMyCourse(
  user: AuthenticatedUser,
  courseId: string,
): Promise<MyCourse[]> {
  const role = roleInCourseFor(user);
  if (!(await taxonomyRepo.courseExists(courseId))) throw notFound("Course not found");
  await enrollmentsRepo.addEnrollment(user.id, courseId, role);
  const codeMap = await taxonomyRepo.findCourseCodesByIds([courseId]);
  await auditService.record(user.id, "user.course_added", "course", courseId, {
    code: codeMap.get(courseId) ?? null,
    roleInCourse: role,
  });
  return listMyCourses(user);
}

export async function removeMyCourse(
  user: AuthenticatedUser,
  courseId: string,
): Promise<MyCourse[]> {
  roleInCourseFor(user); // admins are rejected; keeps behavior consistent with add
  const removed = await enrollmentsRepo.removeEnrollment(user.id, courseId);
  if (removed > 0) {
    const codeMap = await taxonomyRepo.findCourseCodesByIds([courseId]);
    await auditService.record(user.id, "user.course_removed", "course", courseId, {
      code: codeMap.get(courseId) ?? null,
    });
  }
  return listMyCourses(user);
}
