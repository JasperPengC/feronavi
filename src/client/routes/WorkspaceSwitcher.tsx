/**
 * 侧栏工作区上下文（Round 92）：把原先「假切换器」改成真实的**项目切换器**。
 *
 * 现实：Feronavi 是单组织自托管模型，没有多 workspace 实体；这个位置只做两件真实的事：
 *   1 显示组织 + 当前项目（不在项目页时显示"全部项目"）；
 *   2 点开选择当前可见项目，选中后进入该项目概览（侧栏"当前项目"导航随之出现）。
 * 不做假按钮、不假装"切换工作区"。
 */
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { t } from "../i18n/index.ts";
import { Icon } from "../components/Icon.tsx";

export interface ShellProject { id: string; key: string; name: string }

export function WorkspaceSwitcher({ orgName, projects, currentProjectId, currentProjectName, onSelectProject, onSelectAll }: {
  orgName: string;
  projects: ShellProject[];
  currentProjectId: string | null;
  currentProjectName: string | null;
  onSelectProject?: (id: string) => void;
  onSelectAll?: () => void;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!boxRef.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const chooseAll = () => { setOpen(false); onSelectAll?.(); void navigate({ to: "/projects" }); };
  const choose = (id: string) => { setOpen(false); onSelectProject?.(id); void navigate({ to: "/projects/$projectId", params: { projectId: id } }); };

  return (
    <div className="workspace-control" ref={boxRef}>
      <button className="workspace-switcher" type="button" aria-haspopup="menu" aria-expanded={open}
        aria-label={t("workspace.switch")} onClick={() => setOpen((v) => !v)}>
        <span className="workspace-logo" aria-hidden="true">{(orgName || "F").slice(0, 1)}</span>
        <span className="workspace-identity">
          <strong>{orgName}</strong>
          <small>{currentProjectName ?? t("workspace.allProjects")}</small>
        </span>
        <Icon name="chevron-down" />
      </button>
      {open && (
        <div className="workspace-menu menu-panel" role="menu" aria-label={t("workspace.switch")}>
          <div className="workspace-menu-head">{t("workspace.currentOrg")} · {orgName}</div>
          <button type="button" role="menuitemradio" aria-checked={!currentProjectId}
            className="menu-item workspace-menu-item" onClick={chooseAll}>
            <Icon name="layers" />
            <span className="menu-item-label">{t("workspace.allProjects")}</span>
            {!currentProjectId && <Icon name="check" />}
          </button>
          <div className="workspace-menu-sep" />
          {projects.length === 0 && <div className="workspace-menu-empty">{t("workspace.noProjects")}</div>}
          {projects.map((p) => (
            <button key={p.id} type="button" role="menuitemradio" aria-checked={currentProjectId === p.id}
              className="menu-item workspace-menu-item" onClick={() => choose(p.id)}>
              <span className="workspace-menu-key">{p.key}</span>
              <span className="menu-item-label">{p.name}</span>
              {currentProjectId === p.id && <Icon name="check" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
