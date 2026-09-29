/**
 * عقود الهوية الموثوقة — الحد الوحيد الذي تعبره هوية الطلب إلى النطاق.
 * المخططات ترفض أي tenant أو صلاحية قادمة من body أو claim غير مربوط.
 */
import { z } from "zod";
import { AppError } from "./errors/app-error.js";

export const PermissionSchema = z.enum([
  "resource:read",
  "pipeline:run",
  "pipeline:review",
  "artifact:read",
  "flywheel:read",
  "flywheel:write",
  "analytics:read",
  "sso:manage",
  "tenant:admin",
]);
export type Permission = z.infer<typeof PermissionSchema>;

export const MembershipRoleSchema = z.enum(["reader", "operator", "reviewer", "tenant_admin"]);
export type MembershipRole = z.infer<typeof MembershipRoleSchema>;

export const ROLE_PERMISSIONS: Readonly<Record<MembershipRole, readonly Permission[]>> = {
  reader: ["resource:read", "artifact:read", "flywheel:read", "analytics:read"],
  operator: ["resource:read", "pipeline:run", "artifact:read", "flywheel:read", "analytics:read"],
  reviewer: ["resource:read", "pipeline:run", "pipeline:review", "artifact:read", "flywheel:read", "flywheel:write", "analytics:read"],
  tenant_admin: ["resource:read", "pipeline:run", "pipeline:review", "artifact:read", "flywheel:read", "flywheel:write", "analytics:read", "sso:manage", "tenant:admin"],
};

const PrincipalBaseSchema = z.object({
  subjectId: z.string().min(1).max(200),
  tenantId: z.string().min(1).max(200),
  permissions: z.array(PermissionSchema).max(32),
  authorizationVersion: z.number().int().nonnegative(),
  expiresAt: z.string().datetime().optional(),
});

export const UserPrincipalSchema = PrincipalBaseSchema.extend({
  actorType: z.literal("user"),
  authMethod: z.enum(["oidc", "api_key_bridge", "local_bootstrap"]),
  membershipId: z.string().min(1).max(200),
  sessionId: z.string().min(1).max(200),
}).strict();

export const ServicePrincipalSchema = PrincipalBaseSchema.extend({
  actorType: z.literal("service"),
  authMethod: z.literal("api_key"),
  credentialId: z.string().min(1).max(200),
}).strict();

export const PrincipalSchema = z.discriminatedUnion("actorType", [UserPrincipalSchema, ServicePrincipalSchema]);
export type Principal = z.infer<typeof PrincipalSchema>;

export const TenantContextSchema = z.object({ tenantId: z.string().min(1), principal: PrincipalSchema }).strict()
  .refine((value) => value.tenantId === value.principal.tenantId, "هوية المستأجر لا تطابق Principal");
export type TenantContext = z.infer<typeof TenantContextSchema>;

/** يعيد سياقاً متحققاً أو يفشل قبل أي وصول إلى مخزن خاص. */
export function requireTenantContext(value: unknown): TenantContext {
  const parsed = TenantContextSchema.safeParse(value);
  if (!parsed.success) throw new AppError("TENANT_CONTEXT_INVALID", "سياق المستأجر الموثوق مفقود أو متعارض", false, "critical");
  return parsed.data;
}

export function hasPermission(principal: Principal, permission: Permission): boolean {
  return principal.permissions.includes(permission);
}
