/** REST、MCP与详情界面共用的子项投影；不包含正文或其它敏感上下文。 */
export type WorkItemChild = {
  id: string; key: string; title: string; type: string; priority: string | null;
  /** 保留旧客户端读取的字段。 */
  status_id: string;
  statusKey: string | null; statusName: string | null; statusCategory: string | null;
  assigneeId: string | null; assigneeName: string | null; dueDate: string | null;
};
