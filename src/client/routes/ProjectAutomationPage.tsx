/** 项目自动化规则 + SLA 策略（P1-1/P1-2 管理面） */
import { useState } from "react";
import { useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from "../lib/api.ts";
import { t, useLocale } from "../i18n/index.ts";
import { Icon } from "../components/Icon.tsx";
import { PageTabs, TabPanel } from "../components/ui/PageTabs.tsx";
import { PageHead } from "../components/Page.tsx";
import { Button } from "../components/ui/Button.tsx";
import { TextInput } from "../components/ui/TextInput.tsx";
import { Select } from "../components/Select.tsx";
import { Checkbox } from "../components/Checkbox.tsx";
import { toast } from "../components/ui/Toast.tsx";

type Trigger = "WORK_ITEM_CREATED" | "WORK_ITEM_UPDATED" | "STATUS_CHANGED" | "COMMENT_ADDED" | "SLA_BREACHED" | "SCHEDULE";
interface Rule { id: string; name: string; trigger: Trigger; conditions: { all?: unknown[] }; actions: { type: string; [k: string]: unknown }[]; enabled: boolean }
interface Run { run: { id: string; status: string; trigger: string; error: string | null; createdAt: string }; ruleName: string }
interface Policy { id: string; name: string; priority: string | null; severity: string | null; responseMinutes: number; resolveMinutes: number; escalateRoles: string[]; enabled: boolean }
interface MemberRow { id: string; name: string; username: string }

import { StateBlock } from "../components/ui/StateBlock.tsx";
import { ConfirmButton } from "../components/ui/ConfirmButton.tsx";
import { DraftNavigationGuard } from "../components/ui/DraftNavigationGuard.tsx";
import { useCan } from "../lib/actor.ts";

export function ProjectAutomationPage() {
  useLocale();
  const { projectId } = useParams({ strict: false }) as { projectId: string };
  const canManage = useCan("project:update");
  const qc = useQueryClient();
  const [tab, setTab] = useState<"rules" | "sla">("rules");
  const [ruleOpen, setRuleOpen] = useState(false);
  const [policyOpen, setPolicyOpen] = useState(false);
  const triggerOptions = [
    { value: "WORK_ITEM_CREATED", label: "工作项创建" }, { value: "WORK_ITEM_UPDATED", label: "工作项更新" },
    { value: "STATUS_CHANGED", label: "状态变更" }, { value: "COMMENT_ADDED", label: "新增评论" },
    { value: "SLA_BREACHED", label: "SLA 超时" }, { value: "SCHEDULE", label: "定时触发" },
  ];
  const actionLabels: Record<string, string> = { ASSIGN: "指派成员", SET_FIELD: "修改字段", TRANSITION: "流转状态", ADD_COMMENT: "添加评论", NOTIFY: "发送通知" };
  const priorityOptions = ["URGENT", "HIGH", "MEDIUM", "LOW", "LOWEST"].map((value) => ({ value, label: t(`board.priority.${value}`) }));
  const rules = useQuery({ queryKey: ["automation-rules", projectId], queryFn: () => apiGet<{ rules: Rule[] }>(`/api/v1/projects/${projectId}/automation-rules`).then((r) => r.rules), retry: false });
  const runs = useQuery({ queryKey: ["automation-runs", projectId], queryFn: () => apiGet<{ runs: Run[] }>(`/api/v1/projects/${projectId}/automation-runs?limit=20`).then((r) => r.runs), retry: false });
  const policies = useQuery({ queryKey: ["sla-policies", projectId], queryFn: () => apiGet<{ policies: Policy[] }>(`/api/v1/projects/${projectId}/sla-policies`).then((r) => r.policies), retry: false });
  const members = useQuery({ queryKey: ["members", "options"], queryFn: () => apiGet<{ members: MemberRow[] }>("/api/v1/members").then((r) => r.members), retry: false });

  const options = useQuery({ queryKey: ["automation-options", projectId], retry: false, queryFn: async () => {
    const [workflows, iterations, milestones] = await Promise.all([
      apiGet<{ id: string }[]>(`/api/v1/workflows?projectId=${projectId}`),
      apiGet<{ id: string; name: string }[]>(`/api/v1/projects/${projectId}/iterations`),
      apiGet<{ id: string; name: string }[]>(`/api/v1/projects/${projectId}/milestones`),
    ]);
    const states = (await Promise.all(workflows.map(w => apiGet<{ key: string; name: string }[]>(`/api/v1/workflows/${w.id}/states`)))).flat();
    return { states: [...new Map(states.map(state => [state.key, state])).values()], iterations, milestones };
  } });
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState<Trigger>("WORK_ITEM_CREATED");
  const [field, setField] = useState("priority");
  const [op, setOp] = useState("eq");
  const [value, setValue] = useState("URGENT");
  type ActionDraft = { type: string; memberId: string; toStateKey: string; body: string; field: string; value: string };
  const newAction = (): ActionDraft => ({ type: "ASSIGN", memberId: "", toStateKey: "", body: "", field: "priority", value: "" });
  const [actions, setActions] = useState<ActionDraft[]>([newAction()]);
  const [scheduleCron, setScheduleCron] = useState("0 9 * * 1-5");
  const [scheduleTimezone, setScheduleTimezone] = useState("Asia/Shanghai");
  const [enabled, setEnabled] = useState(true);
  const ruleDraft = { name, trigger, field, op, value, actions, scheduleCron, scheduleTimezone, enabled };
  const [ruleBaseline, setRuleBaseline] = useState(() => JSON.stringify(ruleDraft));
  const setAction = (index: number, patch: Partial<ActionDraft>) =>
    setActions((current) => current.map((action, i) => (i === index ? { ...action, ...patch } : action)));
  const addAction = () => setActions((current) => [...current, newAction()]);
  const removeAction = (index: number) => setActions((current) => current.length === 1 ? current : current.filter((_, i) => i !== index));

  const createRule = useMutation({
    mutationFn: () => {
      const payloadActions = actions.map((action) => {
        if (action.type === "ASSIGN") return { type: "ASSIGN", memberId: action.memberId };
        if (action.type === "TRANSITION") return { type: "TRANSITION", toStateKey: action.toStateKey };
        if (action.type === "ADD_COMMENT") return { type: "ADD_COMMENT", body: action.body };
        if (action.type === "SET_FIELD") return { type: "SET_FIELD", field: action.field, value: action.value };
        return { type: "NOTIFY", memberIds: action.memberId ? [action.memberId] : [], title: "自动化通知", body: action.body };
      });
      return apiPost(`/api/v1/projects/${projectId}/automation-rules`, {
        name, trigger, enabled,
        conditions: field === "" ? {} : { all: [{ field, op, value: value.split(",").map((x) => x.trim()).filter(Boolean) }] },
        actions: payloadActions,
        scheduleCron: trigger === "SCHEDULE" ? scheduleCron : null,
        scheduleTimezone: trigger === "SCHEDULE" ? scheduleTimezone : "Asia/Shanghai",
      });
    },
    onSuccess: async () => {
      const nextActions = [newAction()];
      setName(""); setActions(nextActions);
      setRuleBaseline(JSON.stringify({ ...ruleDraft, name: "", actions: nextActions }));
      toast.success("自动化规则已创建");
      await qc.invalidateQueries({ queryKey: ["automation-rules", projectId] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "创建失败"),
  });
  const toggle = useMutation({
    mutationFn: (r: Rule) => apiPatch(`/api/v1/projects/${projectId}/automation-rules/${r.id}`, { enabled: !r.enabled }),
    onSuccess: async () => qc.invalidateQueries({ queryKey: ["automation-rules", projectId] }),
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t("ms.saveFailed")),
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/v1/projects/${projectId}/automation-rules/${id}`),
    onSuccess: async () => qc.invalidateQueries({ queryKey: ["automation-rules", projectId] }),
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t("ms.saveFailed")),
  });

  const [policyName, setPolicyName] = useState("");
  const [priority, setPriority] = useState("");
  const [severity, setSeverity] = useState("");
  const [responseMinutes, setResponseMinutes] = useState("60");
  const [resolveMinutes, setResolveMinutes] = useState("480");
  const [roles, setRoles] = useState("ADMIN");
  const [businessHours, setBusinessHours] = useState(false);
  const [workStart, setWorkStart] = useState("09:00");
  const [workEnd, setWorkEnd] = useState("18:00");
  const [holidays, setHolidays] = useState("");
  const [extraWorkdays, setExtraWorkdays] = useState("");
  const policyDraft = { policyName, priority, severity, responseMinutes, resolveMinutes, roles, businessHours, workStart, workEnd, holidays, extraWorkdays };
  const [policyBaseline, setPolicyBaseline] = useState(() => JSON.stringify(policyDraft));
  const createPolicy = useMutation({
    mutationFn: () => apiPost(`/api/v1/projects/${projectId}/sla-policies`, {
      name: policyName, priority: priority || null, severity: severity || null,
      responseMinutes: Number(responseMinutes), resolveMinutes: Number(resolveMinutes),
      escalateRoles: roles.split(",").map((x) => x.trim()).filter(Boolean),
      calendar: businessHours ? {
        enabled: true, days: [1, 2, 3, 4, 5], start: workStart, end: workEnd,
        holidays: holidays.split(",").map((x) => x.trim()).filter(Boolean),
        extraWorkdays: extraWorkdays.split(",").map((x) => x.trim()).filter(Boolean),
      } : null,
    }),
    onSuccess: async () => {
      setPolicyName("");
      setPolicyBaseline(JSON.stringify({ ...policyDraft, policyName: "" }));
      toast.success("SLA 策略已创建");
      await qc.invalidateQueries({ queryKey: ["sla-policies", projectId] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "创建失败"),
  });
  const removePolicy = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/v1/projects/${projectId}/sla-policies/${id}`),
    onSuccess: async () => qc.invalidateQueries({ queryKey: ["sla-policies", projectId] }),
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t("ms.saveFailed")),
  });

  return (
    <div className="page project-refinement automation-page">
      <PageHead title={t("auto.title")} hint={t("auto.sub")} actions={
        <Button variant="primary" disabled={!canManage} aria-expanded={tab === "rules" ? ruleOpen : policyOpen}
          aria-controls={tab === "rules" ? "automation-rule-form" : "automation-policy-form"}
          onClick={() => tab === "rules" ? setRuleOpen((open) => !open) : setPolicyOpen((open) => !open)}>
          <Icon name={(tab === "rules" ? ruleOpen : policyOpen) ? "x" : "plus"} size={14} />
          {(tab === "rules" ? ruleOpen : policyOpen) ? "收起配置" : tab === "rules" ? "新建规则" : "新建 SLA 策略"}
        </Button>} />
      <DraftNavigationGuard dirty={JSON.stringify(ruleDraft) !== ruleBaseline || JSON.stringify(policyDraft) !== policyBaseline} saving={createRule.isPending || createPolicy.isPending} message={t("flows.discardDraft")} />
      {(members.isError || options.isError) && <StateBlock kind="error" title={t("common.loadFailedShort")} action={() => { void members.refetch(); void options.refetch(); }} actionLabel={t("common.reload")} />}
      <PageTabs id="automation" label={t("auto.title")} value={tab} onChange={setTab}
        tabs={[{ value: "rules", label: "自动化规则" }, { value: "sla", label: "SLA 策略" }]} />

      <TabPanel tabsId="automation" value="rules" activeValue={tab}>
        <div className="automation-layout" data-composing={ruleOpen}>
          <section className="automation-compose" id="automation-rule-form" hidden={!ruleOpen}>
            <h2>新建规则</h2>
            <fieldset className="settings-form-fields" disabled={createRule.isPending}>
            <div className="automation-form-section">
            <h3>基本信息</h3>
            <div className="automation-fields">
              <TextInput label="规则名称" value={name} onChange={(e) => setName(e.target.value)} />
              <Select label="触发时机" ariaLabel="触发时机" value={trigger} onChange={(value) => setTrigger(value as Trigger)} options={triggerOptions} />
              {trigger === "SCHEDULE" && (
                <>
                  <TextInput label="cron 表达式" value={scheduleCron} onChange={(e) => setScheduleCron(e.target.value)} placeholder="0 9 * * 1-5" hint="分 时 日 月 周" />
                  <TextInput label="时区" value={scheduleTimezone} onChange={(e) => setScheduleTimezone(e.target.value)} placeholder="Asia/Shanghai" />
                </>
              )}
            </div>
            <Checkbox checked={enabled} onChange={setEnabled} label="启用" />
            </div>
            <div className="automation-form-section">
              <h3>满足条件</h3>
              <div className="automation-condition-fields">
                <Select label="条件字段" ariaLabel="条件字段" value={field} onChange={setField} options={[
                  { value: "priority", label: "优先级" }, { value: "type", label: "类型" }, { value: "statusKey", label: "状态" }, { value: "assigneeId", label: "负责人" }, { value: "", label: "无条件" },
                ]} />
                {field && <>
                  <Select label="匹配方式" ariaLabel="操作符" value={op} onChange={setOp} options={[{ value: "eq", label: "等于" }, { value: "neq", label: "不等于" }, { value: "in", label: "属于任意一项" }]} />
                  {field === "priority" && op !== "in"
                    ? <Select label="条件值" ariaLabel="条件值" value={value} onChange={setValue} options={priorityOptions} />
                    : <TextInput label="条件值" value={value} onChange={(event) => setValue(event.target.value)} hint={op === "in" ? "多个值用逗号分隔" : undefined} />}
                </>}
              </div>
            </div>
            <div className="automation-form-section">
            <div className="automation-actions-head">
              <h3>执行动作</h3>
              <Button size="sm" variant="ghost" onClick={addAction}><Icon name="plus" size={14} />添加动作</Button>
            </div>
            <div className="automation-actions">
              {actions.map((action, index) => (
                <div className="automation-action-card" key={index}>
                  <div className="automation-action-fields">
                    <Select label={`动作 ${index + 1}`} ariaLabel={`动作 ${index + 1}`} value={action.type} onChange={(value) => setAction(index, { type: value })}
                      options={[
                        { value: "ASSIGN", label: "指派给" }, { value: "SET_FIELD", label: "修改字段" },
                        { value: "TRANSITION", label: "流转到状态" }, { value: "ADD_COMMENT", label: "添加评论" }, { value: "NOTIFY", label: "通知" },
                      ]} />
                    {(action.type === "ASSIGN" || action.type === "NOTIFY") ? (
                      <Select label={`动作 ${index + 1} 成员`} ariaLabel={`动作 ${index + 1} 成员`} value={action.memberId} onChange={(value) => setAction(index, { memberId: value })} searchable
                        options={[{ value: "", label: "选择成员" }, ...(members.data ?? []).map((m) => ({ value: m.id, label: `${m.name} (${m.username})` }))]} />
                    ) : action.type === "TRANSITION" ? (
                      <Select label={t("admin.targetState")} ariaLabel={t("admin.targetState")} value={action.toStateKey} disabled={!options.isSuccess} onChange={(toStateKey) => setAction(index, { toStateKey })} searchable options={(options.data?.states ?? []).map(state => ({ value: state.key, label: state.name }))} />
                    ) : action.type === "SET_FIELD" ? (
                      <>
                        <Select label={`动作 ${index + 1} 字段`} ariaLabel={`动作 ${index + 1} 字段`} value={action.field} onChange={(value) => setAction(index, { field: value })}
                          options={[{ value: "priority", label: "优先级" }, { value: "assigneeId", label: t("common.assignee") }, { value: "iterationId", label: t("po.iterations") }, { value: "milestoneId", label: t("nav.milestones") }]} />
                        <Select label={t("admin.targetValue")} ariaLabel={t("admin.targetValue")} value={action.value} onChange={(value) => setAction(index, { value })} searchable
                          options={action.field === "priority" ? ["URGENT", "HIGH", "MEDIUM", "LOW", "LOWEST"].map(value => ({ value, label: t(`board.priority.${value}`) }))
                            : action.field === "assigneeId" ? (members.data ?? []).map(member => ({ value: member.id, label: member.name }))
                              : ((action.field === "iterationId" ? options.data?.iterations : options.data?.milestones) ?? []).map(item => ({ value: item.id, label: item.name }))} />
                      </>
                    ) : (
                      <TextInput label="评论文案" value={action.body} onChange={(e) => setAction(index, { body: e.target.value })} />
                    )}
                    {action.type === "NOTIFY" && <TextInput label="通知内容" value={action.body} onChange={(event) => setAction(index, { body: event.target.value })} />}
                    <div className="automation-action-remove">
                      <Button size="sm" variant="ghost" disabled={actions.length === 1} onClick={() => removeAction(index)}>移除动作</Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            </div>
            <div className="automation-form-actions">
              <Button variant="primary" loading={createRule.isPending} disabled={!canManage || !name.trim() || createRule.isPending} onClick={() => createRule.mutate()}>创建规则</Button>
            </div>
            </fieldset>
          </section>

          <div className="automation-records-column">
          <section className="automation-records">
            <h2 style={{ margin: "0 0 10px", fontSize: 14 }}>规则列表</h2>
            {rules.isLoading && <p className="muted">{t("common.loading")}</p>}
            {rules.isError && <StateBlock kind="error" title={t("common.loadFailedShort")} action={() => void rules.refetch()} actionLabel={t("common.reload")} />}
            {rules.isSuccess && rules.data?.length === 0 && <p className="muted">还没有自动化规则。</p>}
            {!!rules.data?.length && (
              <ul className="settings-record-list">
                {rules.data.map((r) => (
                  <li key={r.id}>
                    <span className="settings-record-main">
                      <strong>{r.name} <span className="tag">{triggerOptions.find((option) => option.value === r.trigger)?.label ?? r.trigger}</span></strong>
                      <span className="settings-record-detail">{r.actions.map((action) => actionLabels[action.type] ?? action.type).join(" · ")}</span>
                    </span>
                    <Checkbox disabled={!canManage || toggle.isPending} checked={r.enabled} onChange={() => toggle.mutate(r)} ariaLabel={`启用规则 ${r.name}`} />
                    <ConfirmButton size="sm" disabled={!canManage || remove.isPending} onConfirm={() => remove.mutate(r.id)}>{t("common.delete")}</ConfirmButton>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="automation-records">
            <h2 style={{ margin: "0 0 10px", fontSize: 14 }}>最近执行</h2>
            {runs.isLoading && <StateBlock kind="loading" title={t("common.loading")} />}
            {runs.isError && <StateBlock kind="error" title={t("common.loadFailedShort")} action={() => void runs.refetch()} actionLabel={t("common.reload")} />}
            {runs.isSuccess && !runs.data?.length && <p className="muted">还没有执行记录。</p>}
            {!!runs.data?.length && <ul className="settings-record-list">{runs.data.map((x) => (
              <li key={x.run.id}><span className="settings-record-main"><strong>{x.ruleName}</strong><span className="settings-record-detail">{triggerOptions.find((option) => option.value === x.run.trigger)?.label ?? x.run.trigger} · {({ SUCCEEDED: "成功", SUCCESS: "成功", FAILED: "失败", SKIPPED: "已跳过", RUNNING: "执行中" } as Record<string, string>)[x.run.status] ?? x.run.status}{x.run.error ? ` · ${x.run.error}` : ""}</span></span><span className="muted">{new Date(x.run.createdAt).toLocaleString()}</span></li>
            ))}</ul>}
          </section>
          </div>
        </div>
      </TabPanel>

      <TabPanel tabsId="automation" value="sla" activeValue={tab}>
        <div className="automation-layout" data-composing={policyOpen}>
          <section className="automation-compose" id="automation-policy-form" hidden={!policyOpen}>
            <h2>新建 SLA 策略</h2>
            <fieldset className="settings-form-fields" disabled={createPolicy.isPending}>
            <div className="automation-form-section">
              <h3>适用范围</h3>
              <TextInput label="策略名称" value={policyName} onChange={(event) => setPolicyName(event.target.value)} />
              <div className="automation-fields">
                <Select label="优先级" ariaLabel="优先级" value={priority} onChange={setPriority} options={[{ value: "", label: "不限" }, ...priorityOptions]} />
                <Select label="严重度" ariaLabel="严重度" value={severity} onChange={setSeverity} options={[{ value: "", label: "不限" }, ...["S1", "S2", "S3", "S4"].map((value) => ({ value, label: value }))]} />
              </div>
            </div>
            <div className="automation-form-section">
              <h3>处理时限</h3>
              <div className="automation-fields">
                <TextInput label="响应时限（分钟）" type="number" min={1} value={responseMinutes} onChange={(event) => setResponseMinutes(event.target.value)} />
                <TextInput label="解决时限（分钟）" type="number" min={1} value={resolveMinutes} onChange={(event) => setResolveMinutes(event.target.value)} />
              </div>
              <TextInput label="超时通知角色" value={roles} onChange={(event) => setRoles(event.target.value)} hint="填写角色标识，多个角色用逗号分隔。" />
            </div>
            <div className="automation-form-section">
              <h3>计时安排</h3>
              <Checkbox checked={businessHours} onChange={setBusinessHours} label="仅工作时间计时" />
              {businessHours && (
                <div className="automation-fields">
                  <TextInput label="上班时间" type="time" value={workStart} onChange={(e) => setWorkStart(e.target.value)} />
                  <TextInput label="下班时间" type="time" value={workEnd} onChange={(e) => setWorkEnd(e.target.value)} />
                  <TextInput label="法定节假日" value={holidays} onChange={(e) => setHolidays(e.target.value)} placeholder="2026-10-01,2026-10-02" hint="YYYY-MM-DD，逗号分隔" />
                  <TextInput label="调休上班日" value={extraWorkdays} onChange={(e) => setExtraWorkdays(e.target.value)} placeholder="2026-10-10" hint="周末补班日期，YYYY-MM-DD" />
                </div>
              )}
            </div>
            <div className="automation-form-actions">
              <Button variant="primary" loading={createPolicy.isPending} disabled={!canManage || !policyName.trim() || createPolicy.isPending} onClick={() => createPolicy.mutate()}>创建策略</Button>
            </div>
            </fieldset>
          </section>
          <section className="automation-records">
            <h2 style={{ margin: "0 0 10px", fontSize: 14 }}>策略列表</h2>
            {policies.isLoading && <StateBlock kind="loading" title={t("common.loading")} />}
            {policies.isError && <StateBlock kind="error" title={t("common.loadFailedShort")} action={() => void policies.refetch()} actionLabel={t("common.reload")} />}
            {policies.isSuccess && !policies.data?.length && <p className="muted">还没有 SLA 策略。</p>}
            {!!policies.data?.length && <ul className="settings-record-list">{policies.data.map((p) => (
              <li key={p.id}><span className="settings-record-main"><strong>{p.name}</strong><span className="settings-record-detail">响应 {p.responseMinutes} 分钟 · 解决 {p.resolveMinutes} 分钟 · 升级 {p.escalateRoles.join(", ")}</span></span><ConfirmButton size="sm" disabled={!canManage || removePolicy.isPending} onConfirm={() => removePolicy.mutate(p.id)}>{t("common.delete")}</ConfirmButton></li>
            ))}</ul>}
          </section>
        </div>
      </TabPanel>

    </div>
  );
}
