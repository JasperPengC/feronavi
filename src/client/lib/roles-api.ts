import { apiDelete, apiGet, apiPatch, apiPost } from "./api.ts";

export type ScopeType = "ORG" | "TEAM" | "PROJECT" | "DEPARTMENT";

export interface RoleView {
  id: string;
  key: string;
  name: string;
  isBuiltin: boolean;
  isSystem: boolean;
  permissionKeys: string[];
}

export interface PermissionItem { key: string; group: string; description: string }
export interface PermissionGroup { group: string; permissions: PermissionItem[] }
export interface RoleAssignment {
  id: string;
  memberId: string;
  roleId: string;
  roleKey: string;
  roleName: string;
  roleIsBuiltin: boolean;
  scopeType: ScopeType;
  scopeId: string | null;
  scopeName: string | null;
}
export interface ScopeOption { id: string; name: string }

export const rolesApi = {
  list: () => apiGet<{ roles: RoleView[] }>("/api/v1/roles"),
  permissions: () => apiGet<{ groups: PermissionGroup[] }>("/api/v1/permissions"),
  scopeOptions: (scopeType: Exclude<ScopeType, "ORG">) =>
    apiGet<{ scopeType: Exclude<ScopeType, "ORG">; scopes: ScopeOption[] }>("/api/v1/roles/scope-options", { scopeType }),
  create: (input: { slug: string; name: string; permissionKeys: string[] }) =>
    apiPost<RoleView>("/api/v1/roles", input),
  update: (id: string, patch: { name?: string; permissionKeys?: string[] }) =>
    apiPatch<RoleView>(`/api/v1/roles/${id}`, patch),
  remove: (id: string) => apiDelete<{ ok: true }>(`/api/v1/roles/${id}`),
  assignments: (memberId: string) =>
    apiGet<{ assignments: RoleAssignment[] }>("/api/v1/role-assignments", { memberId }),
  assign: (input: { memberId: string; roleId: string; scopeType: ScopeType; scopeId: string | null }) =>
    apiPost<RoleAssignment>("/api/v1/role-assignments", input),
  updateAssignment: (id: string, patch: { roleId: string; scopeType: ScopeType; scopeId: string | null }) =>
    apiPatch<RoleAssignment>(`/api/v1/role-assignments/${id}`, patch),
  removeAssignment: (id: string) => apiDelete<{ ok: true }>(`/api/v1/role-assignments/${id}`),
};
