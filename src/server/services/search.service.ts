/**
 * 全局搜索（W4，REST 7e）
 *
 * 规则：
 *   1 **数据范围过滤在 SQL 里做**（不是查全再内存滤）—— 搜索结果绝不能泄露无权项目
 *   2 中文 zhparser 命中 + ILIKE 兜底（分词器对短词/英文的处理不完美，双保险）
 *   3 语义搜索（semantic=true）属 P4 RAG，本期**明确不接**，传了也不报错、忽略之
 */
import { sql } from "../../db/index.ts";
import { DomainError } from "../../shared/errors.ts";
import type { Actor } from "../permission/actor.ts";

function hasOrgGrant(actor: Actor): boolean {
  return actor.grants.some((g) => g.scopeType === "ORG");
}

export interface SearchHit {
  type: "work-item" | "project" | "page" | "idea" | "member";
  id: string;
  key: string | null;
  title: string;
  projectKey: string | null;
  projectId: string | null;
  /** 命中片段（title 或 description 前段） */
  snippet: string | null;
}

export async function search(actor: Actor, q: string, opts: { type?: string; limit?: number } = {}) {
  const query = q.trim();
  if (query.length < 1) throw new DomainError("VALIDATION", "搜索词不能为空", null);
  if (query.length > 200) throw new DomainError("VALIDATION", "搜索词过长", null);
  if (opts.type && opts.type !== "work-item") {
    throw new DomainError("VALIDATION", "本期仅支持 type=work-item", null);
  }
  const limit = Math.min(50, Math.max(1, opts.limit ?? 20));

  // 数据范围（与工作台同口径）：ORG 档全可见，否则只看成员项目 / PROJECT 指派
  const scope = hasOrgGrant(actor)
    ? sql`true`
    : sql`(w.project_id in (select project_id from project_membership where member_id = ${actor.memberId})
           or w.project_id in (select scope_id from role_assignment
                               where member_id = ${actor.memberId} and scope_type = 'PROJECT' and scope_id is not null))`;

  // ⚠️ q 直接进入 plainto_tsquery/ILIKE 的参数位（不拼字符串），天然免注入
  const rows = await sql<{
    id: string; key: string; title: string; project_id: string; project_key: string; description: string | null;
  }[]>`
    select w.id, w.key, w.title, w.project_id, p.key as project_key, w.description
    from work_item w join project p on p.id = w.project_id
    where w.deleted_at is null
      and ${scope}
      and (
        to_tsvector('chinese_zh', coalesce(w.title,'') || ' ' || coalesce(w.description,''))
          @@ plainto_tsquery('chinese_zh', ${query})
        or w.title ilike ${"%" + query + "%"}
        or w.key ilike ${"%" + query + "%"}
        or coalesce(w.description,'') ilike ${"%" + query + "%"}
      )
    order by
      (case when w.title ilike ${"%" + query + "%"} then 0
            when w.key ilike ${"%" + query + "%"} then 1 else 2 end),
      w.number desc
    limit ${limit}
  `;

  const items: SearchHit[] = rows.map((r) => ({
    type: "work-item",
    id: r.id,
    key: r.key,
    title: r.title,
    projectKey: r.project_key,
    projectId: r.project_id,
    snippet: r.description ? r.description.slice(0, 120) : null,
  }));

  // 项目 / 文档 / 想法：同样在 SQL 里做数据范围过滤；受限文档不进入全局搜索，避免泄露。
  const like = `%${query}%`;
  const projectScope = hasOrgGrant(actor)
    ? sql`true`
    : sql`(p.id in (select project_id from project_membership where member_id = ${actor.memberId})
           or p.id in (select scope_id from role_assignment
                       where member_id = ${actor.memberId} and scope_type = 'PROJECT' and scope_id is not null))`;
  const [projectRows, pageRows, ideaRows, memberRows] = await Promise.all([
    sql<{ id: string; key: string; name: string; description: string | null }[]>`
      select p.id, p.key, p.name, p.description from project p
      where p.archived_at is null and ${projectScope}
        and (p.name ilike ${like} or p.key ilike ${like} or coalesce(p.description,'') ilike ${like})
      order by (case when p.key ilike ${like} then 0 else 1 end), p.name limit ${limit}
    `,
    sql<{ id: string; title: string; project_id: string; project_key: string }[]>`
      select pg.id, pg.title, p.id as project_id, p.key as project_key
      from page pg join project p on p.id = pg.project_id
      where pg.deleted_at is null and pg.kind = 'DOCUMENT' and not exists(select 1 from archived_page a where a.id = pg.id) and pg.visibility = 'PROJECT' and ${projectScope}
        and pg.title ilike ${like}
      order by pg.updated_at desc limit ${limit}
    `,
    sql<{ id: string; title: string; description: string | null; project_id: string; project_key: string }[]>`
      select i.id, i.title, i.description, p.id as project_id, p.key as project_key
      from idea i join project p on p.id = i.project_id
      where i.deleted_at is null and ${projectScope}
        and (i.title ilike ${like} or coalesce(i.description,'') ilike ${like})
      order by i.updated_at desc limit ${limit}
    `,
    hasOrgGrant(actor)
      ? sql<{ id: string; name: string; username: string }[]>`
          select id, name, username from member
          where coalesce(name,'') ilike ${like} or username ilike ${like}
          order by name limit ${limit}
        `
      : sql<{ id: string; name: string; username: string }[]>`
          select m.id, m.name, m.username from member m
          where (coalesce(m.name,'') ilike ${like} or m.username ilike ${like})
            and m.id in (select member_id from project_membership where project_id in
              (select project_id from project_membership where member_id = ${actor.memberId}))
          order by m.name limit ${limit}
        `,
  ]);
  for (const r of projectRows) items.push({
    type: "project", id: r.id, key: r.key, title: r.name, projectKey: r.key, projectId: r.id,
    snippet: r.description ? r.description.slice(0, 120) : null,
  });
  for (const r of pageRows) items.push({
    type: "page", id: r.id, key: null, title: r.title, projectKey: r.project_key, projectId: r.project_id, snippet: null,
  });
  for (const r of ideaRows) items.push({
    type: "idea", id: r.id, key: null, title: r.title, projectKey: r.project_key, projectId: r.project_id,
    snippet: r.description ? r.description.slice(0, 120) : null,
  });
  for (const r of memberRows) items.push({
    type: "member", id: r.id, key: r.username, title: r.name, projectKey: null, projectId: null, snippet: null,
  });
  return { items: items.slice(0, limit), total: items.length };
}
