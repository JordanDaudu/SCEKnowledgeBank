import type { AuthenticatedUser } from "../middlewares/auth";

/** The shape returned by GET /auth/me and the profile mutation endpoints. */
export function currentUserDto(u: AuthenticatedUser) {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    username: u.username,
    primaryRole: u.primaryRole,
    roles: u.roles,
    enrollments: u.enrollments,
    avatarUrl: u.avatarStoragePath ? `/api/users/${u.id}/avatar` : null,
    createdAt: u.createdAt,
  };
}
