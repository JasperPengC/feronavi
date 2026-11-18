/**
 * 成员权限详情抽屉（Round 25 长任务第 53 项）
 *
 * 后端 `GET /members/:id/permissions` 第 50 轮已实现但**没有前端页面**（当时如实登记）。
 * 本组件把角色指派（含 ORG/TEAM/PROJECT 作用域）与权限 key 并集展示出来，管理员排查
 * "为什么他能/不能做某操作"时有据可查；普通成员只能看自己（服务端判定）。
 */
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../lib/api.ts";
import { t } from "../i18n/index.ts";
import { Drawer } from "./ui/Drawer.tsx";

interface PermissionsView {
  member: { id: string; username: string; name: string };
  assignments: { id: string; scopeType: string; scopeId: string | null; role: { id: string; key: string; name: string } }[];
  permissions: string[];
}
export interface PermissionTarget { id: string; name: string }

export function MemberPermissionsDrawer({ member, onClose }: { member: PermissionTarget | null; onClose: () => void }) {
  const q = useQuery({
    queryKey: ["member-permissions", member?.id],
    enabled: !!member,
    retry: false,
    queryFn: () => apiGet<PermissionsView>(`/api/v1/members/${member!.id}/permissions`),
  });
  return (
    <Drawer open={!!member} title={member ? `${member.name} · ${t("ms.permissions")}` : t("ms.permissions")} onClose={onClose} width="md">
      {q.isLoading && <p className="muted">{t("common.loading")}</p>}
      {q.isError && <p className="field-error" role="alert">{t("perm.loadFailed")}</p>}
      {q.data && (
        <div className="perm-drawer">
          <section>
            <h3 className="perm-drawer__title">{t("perm.roles")}</h3>
            {q.data.assignments.length === 0 && <p className="muted">{t("perm.noRoles")}</p>}
            <ul className="perm-role-list">
              {q.data.assignments.map((a) => (
                <li key={a.id}>
                  <strong>{a.role.name}</strong>
                  <span className="tag">{a.scopeType}</span>
                  {a.scopeId && <span className="muted mono" style={{ fontSize: "var(--text-xs)" }}>{a.scopeId.slice(0, 8)}…</span>}
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h3 className="perm-drawer__title">{t("perm.permissions")}（{q.data.permissions.length}）</h3>
            {q.data.permissions.length === 0 && <p className="muted">{t("perm.empty")}</p>}
            <div className="perm-chips">
              {q.data.permissions.map((p) => <code key={p} className="perm-chip">{p}</code>)}
            </div>
          </section>
        </div>
      )}
    </Drawer>
  );
}
