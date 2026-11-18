/**
 * 组织信息 hook（Round 25 长任务第 52 项）
 *
 * 组织名称是实例级品牌：登录页、侧栏工作区、页脚都要显示真实组织名，
 * 而不是到处硬编码产品名。公开 GET /organization，未登录也可用。
 */
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "./api.ts";

export interface OrgInfo { id: string; name: string; logoUrl: string | null; defaultLocale: string; defaultTimezone: string }

export function useOrg() {
  return useQuery({
    queryKey: ["organization"],
    queryFn: () => apiGet<OrgInfo>("/api/v1/organization"),
    staleTime: 5 * 60_000,
    retry: false,
  });
}

/** 把浏览器标签标题同步为「组织名 · Feronavi」（组织名未加载/为空时保持产品名） */
export function useDocumentTitle(suffix?: string): void {
  const org = useOrg();
  const name = org.data?.name?.trim();
  useEffect(() => {
    const base = name ? `${name} · Feronavi` : "Feronavi";
    document.title = suffix ? `${suffix} · ${base}` : base;
  }, [name, suffix]);
}
