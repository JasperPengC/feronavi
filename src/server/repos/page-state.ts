import { and, eq, isNull, sql } from "drizzle-orm";
import { page } from "../../db/schema.ts";

/** 归档对子树即时生效；检索必须在查询时过滤，不能依赖异步删除向量。 */
// 显式限定外层表；Drizzle 在 SELECT 投影里会把列简化为 id，造成子查询自比较。
export const pageArchived = () => sql<boolean>`exists (select 1 from archived_page a where a.id = "page"."id")`;
export const pageActive = () => sql`not (${pageArchived()})`;
export const searchablePage = () => and(eq(page.kind, "DOCUMENT"), isNull(page.deletedAt), pageActive())!;
