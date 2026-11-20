/**
 * 项目成员管理抽屉（Round 25 长任务第 55 项）
 *
 * 第 54 轮补齐了 `POST/DELETE /projects/:id/members` 与邀请项目角色，但如实登记"项目成员管理界面未做"。
 * 本组件提供：成员名单（含项目级角色）、加成员（成员 + 角色）、移除成员。
 * 需要 `project:manage_member`；角色下拉需要 `role:manage`（普通成员看不到角色列表时不显示加人表单）。
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiGet, apiPost, ApiError } from "../lib/api.ts";
import { toast } from "./ui/Toast.tsx";
import { t } from "../i18n/index.ts";
import { useCan } from "../lib/actor.ts";
import { Drawer } from "./ui/Drawer.tsx";
import { Button } from "./ui/Button.tsx";
import { Select } from "./Select.tsx";
import { firstGrapheme } from "../lib/first-grapheme.ts";
import { Icon } from "./Icon.tsx";

interface ProjectMember { id: string; username: string; name: string; role_key: string | null; role_name: string | null }
interface MemberOption { id: string; name: string; username: string }
interface RoleOption { id: string; name: string; key: string }

export function ProjectMembersDrawer({ project, onClose }: { project: { id: string; name: string } | null; onClose: () => void }) {
  const qc = useQueryClient();
  const canManage = useCan("project:manage_member");
  const canRole = useCan("role:manage");
  const [memberId, setMemberId] = useState("");
  const [roleIds, setRoleIds] = useState<string[]>([]);

  useEffect(() => { setMemberId(""); setRoleIds([]); }, [project?.id]);

  const members = useQuery({
    queryKey: ["project-members", project?.id],
    enabled: !!project,
    retry: false,
    queryFn: () => apiGet<{ members: ProjectMember[] }>(`/api/v1/projects/${project!.id}/members`).then((r) => r.members),
  });
  const allMembers = useQuery({
    queryKey: ["members", "options"],
    enabled: !!project && canManage && canRole,
    retry: false,
    queryFn: () => apiGet<{ members: MemberOption[] }>("/api/v1/members").then((r) => r.members),
  });
  const roles = useQuery({
    queryKey: ["roles", "project-members-options"],
    enabled: !!project && canManage && canRole,
    retry: false,
    queryFn: () => apiGet<{ roles: RoleOption[] }>("/api/v1/roles").then((r) => r.roles),
  });

  const inval = async () => {
    await qc.invalidateQueries({ queryKey: ["project-members", project?.id] });
  };
  const add = useMutation({
    mutationFn: () => apiPost(`/api/v1/projects/${project!.id}/members`, { memberId, roleId: roleIds[0], roleIds }),
    onSuccess: async () => {
      setMemberId(""); setRoleIds([]); toast.success(t("pm.added"));
      await inval();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t("pm.failed")),
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/v1/projects/${project!.id}/members/${id}`),
    onSuccess: async () => { toast.success(t("pm.removed")); await inval(); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t("pm.failed")),
  });

  // 防御：接口被代理/旧缓存包装成非数组时不能让整页崩掉（严格数组判断）
  const memberList = Array.isArray(members.data) ? members.data : [];
  const allMemberList = Array.isArray(allMembers.data) ? allMembers.data : [];
  const roleList = Array.isArray(roles.data) ? roles.data : [];
  const memberOptions = useMemo(() => {
    const existing = new Set(memberList.map((m) => m.id));
    return allMemberList.filter((m) => !existing.has(m.id)).map((m) => ({ value: m.id, label: m.name || m.username, secondaryLabel: `@${m.username}` }));
  }, [memberList, allMemberList]);
  const toggleRole = (id: string) => setRoleIds((cur) => cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);

  return (
    <Drawer open={!!project} title={project ? `${project.name} · ${t("pm.title")}` : t("pm.title")} onClose={onClose} width="md">
      <div className="project-members">
        {members.isLoading && <p className="muted">{t("common.loading")}</p>}
        {members.isError && <p className="field-error">{t("pm.failed")}</p>}
        {memberList.length === 0 && !members.isLoading && <p className="muted">{t("pm.empty")}</p>}
        {!!memberList.length && (
          <ul className="project-member-list">
            {memberList.map((m) => (
              <li key={m.id}>
                <span className="row-avatar" aria-hidden="true">{firstGrapheme(m.name, m.username)}</span>
                <span className="pm-name"><span title={m.name}>{m.name || m.username}</span><small title={`@${m.username}`}>@{m.username}</small></span>
                <span className="tag pm-member-role" title={m.role_name ?? undefined}>{m.role_name ?? "—"}</span>
                {canManage && <Button size="sm" variant="ghost" disabled={remove.isPending} onClick={() => remove.mutate(m.id)}>{t("pm.remove")}</Button>}
              </li>
            ))}
          </ul>
        )}
        {canManage && canRole && (
          <div className="project-member-add">
            <Select label={t("pm.member")} ariaLabel={t("pm.member")} value={memberId} onChange={setMemberId} searchable placeholder={t("pm.pickMember")} minPanelWidth={280} disabled={allMembers.isLoading || add.isPending} options={memberOptions} />
            <fieldset className="pm-role-field" disabled={add.isPending}>
              <legend>{t("pm.roles")}</legend>
              <div className="pm-role-picker">
              {roleList.map((r) => (
                <button key={r.id} type="button" className="pm-role-option"
                  aria-label={`${t("pm.role")}：${r.name}`} aria-pressed={roleIds.includes(r.id)} onClick={() => toggleRole(r.id)}><Icon name="check" /><span>{r.name}</span></button>
              ))}
              </div>
            </fieldset>
            <Button className="pm-add-submit" variant="primary" disabled={!memberId || roleIds.length === 0 || add.isPending} onClick={() => add.mutate()}>{t("pm.add")}</Button>
          </div>
        )}
        {!canRole && <p className="muted" style={{ fontSize: "var(--text-xs)" }}>{t("pm.needRolePerm")}</p>}
      </div>
    </Drawer>
  );
}
