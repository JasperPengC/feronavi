/** 确认卡只展示业务内容；不回显秘密、内部版本与opaque引用。 */
export function workflowPresentation(
  title: string,
  args: Record<string, unknown>,
  observations: { value: unknown }[],
) {
  const labels: Record<string, string> = {
    title: "标题",
    name: "名称",
    key: "标识",
    description: "说明",
    body: "内容",
    dueDate: "截止日期",
    done: "完成状态",
    startAt: "开始时间",
    endAt: "结束时间",
    filename: "文件",
    mimeType: "类型",
    source: "来源",
    encoding: "编码",
    kind: "服务类型",
    baseUrl: "服务地址",
    config: "配置",
    mapping: "导入映射",
    mappingConfig: "导入映射",
    isActive: "启用",
    enabled: "启用",
    event: "触发事件",
    conditions: "条件",
    actions: "执行动作",
    scopeType: "授权范围",
    permissions: "权限",
    color: "颜色",
    note: "备注",
    startedAt: "实际开始",
    endedAt: "实际结束",
    actualMinutes: "专注分钟",
    layout: "布局",
    type: "类型",
    position: "位置",
    retryFailedOnly: "仅重试失败行",
  };
  const names = new Map<string, string>();
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const row = node as Record<string, unknown>;
    if (typeof row.id === "string") {
      const name = [row.key, row.title ?? row.name ?? row.username]
        .filter(Boolean)
        .join(" · ");
      if (name) names.set(row.id, name);
    }
    for (const value of Object.values(node)) visit(value);
  };
  observations.forEach((row) => visit(row.value));
  const format = (value: unknown): string => {
    if (value === null) return "未设置";
    if (typeof value === "boolean") return value ? "是" : "否";
    if (typeof value === "string")
      return (
        names.get(value) ??
        (/^[a-f0-9-]{36}$/i.test(value) ? "已选业务对象" : value)
      );
    if (Array.isArray(value)) return value.map(format).join("、");
    if (value && typeof value === "object")
      return Object.entries(value)
        .map(([k, v]) => `${labels[k] ?? k}：${format(v)}`)
        .join("；");
    return String(value);
  };
  const fields = Object.entries(args)
    .filter(
      ([key]) =>
        ![
          "projectId",
          "idempotencyKey",
          "artifactId",
          "credentialRef",
          "expectedVersion",
          "version",
        ].includes(key),
    )
    .map(([key, value]) => ({
      label:
        labels[key] ??
        (key.endsWith("Id") || key.endsWith("Ids") ? "业务对象" : "设置"),
      value: format(value).slice(0, 4000),
    }));
  if (title === "执行已预演导入")
    for (const row of observations) {
      const text = JSON.stringify(row.value);
      const report = JSON.parse(text) as Record<string, unknown>;
      const find = (n: unknown): Record<string, unknown> | undefined => {
        if (!n || typeof n !== "object") return;
        const r = n as Record<string, unknown>;
        if (r._dryRun && typeof r._dryRun === "object")
          return r._dryRun as Record<string, unknown>;
        for (const v of Object.values(r)) {
          const found = find(v);
          if (found) return found;
        }
      };
      const dry = find(report);
      if (dry)
        fields.push({
          label: "预演结果",
          value: `总行数 ${dry.totalRows}；将创建 ${dry.willCreate}；跳过 ${dry.willSkip}；失败 ${dry.failed}。失败行不会导入。`,
        });
    }
  return { title, fields };
}
