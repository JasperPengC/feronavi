import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setLocale } from "../src/client/i18n/index.ts";
import { NotificationBell } from "../src/client/routes/NotificationBell.tsx";

const notificationApi = vi.hoisted(() => ({ list: vi.fn(), markRead: vi.fn() }));

vi.mock("../src/client/lib/planning-api.ts", () => ({ notifications: notificationApi }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, ...props }: { to: string; children: React.ReactNode }) => <a href={to} {...props}>{children}</a>,
}));
vi.mock("../src/client/components/work-item/DeferredWorkItemDrawer.tsx", () => ({ WorkItemDrawer: ({ workItemId }: { workItemId: string | null }) => workItemId ? <div role="dialog" aria-label={`工作项 ${workItemId}`} /> : null }));

const rows = [
  { id: "unread-1", type: "mention", category: "work", title: "被提及的通知", body: "请检查这一项", link: "/work-items/work-1", readAt: null, itemCount: 1, createdAt: "2026-11-16T12:00:00.000Z" },
  { id: "read-1", type: "update", category: "work", title: "已读通知", body: "已处理", link: null, readAt: "2026-11-16T11:00:00.000Z", itemCount: 1, createdAt: "2026-11-16T10:00:00.000Z" },
];

function renderBell(unreadCount: number) {
  notificationApi.list.mockResolvedValue({ items: rows, unreadCount });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><NotificationBell /></QueryClientProvider>);
}

beforeEach(() => setLocale("zh-CN"));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("caps the visible count while keeping the exact count in the accessible name", async () => {
  renderBell(127);
  const bell = await screen.findByRole("button", { name: "通知，127 条未读" });
  expect(within(bell).getByText("99+")).toBeTruthy();
});

it("offers a work item link that opens the drawer on an ordinary click", async () => {
  renderBell(1);
  fireEvent.click(await screen.findByRole("button", { name: "通知，1 条未读" }));
  const link = screen.getByRole("link", { name: "查看工作项" });
  expect(link.getAttribute("href")).toBe("/notifications?item=work-1");
  fireEvent.click(link);
  expect(screen.getByRole("dialog", { name: "工作项 work-1" })).toBeTruthy();
  expect(screen.queryByRole("dialog", { name: "通知" })).toBeNull();
});

it("preserves modified link clicks for opening a work item in another tab", async () => {
  renderBell(1);
  fireEvent.click(await screen.findByRole("button", { name: "通知，1 条未读" }));
  const link = screen.getByRole("link", { name: "查看工作项" });
  // 捕获浏览器默认行为是否被阻止，避免 jsdom 执行页面导航。
  const event = new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true });
  let preventedByLink = true;
  document.addEventListener("click", (click) => { preventedByLink = click.defaultPrevented; click.preventDefault(); }, { once: true });
  link.dispatchEvent(event);
  expect(preventedByLink).toBe(false);
  expect(screen.queryByRole("dialog", { name: "工作项 work-1" })).toBeNull();
});

it("updates the unread state after the read action succeeds", async () => {
  renderBell(1);
  notificationApi.markRead.mockResolvedValue({ ok: true });
  fireEvent.click(await screen.findByRole("button", { name: "通知，1 条未读" }));
  notificationApi.list.mockResolvedValue({ items: rows.map(row => ({ ...row, readAt: "2026-11-16T13:00:00.000Z" })), unreadCount: 0 });
  fireEvent.click(screen.getByRole("button", { name: "标为已读" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "标为已读" })).toBeNull());
  expect(screen.getByRole("button", { name: "通知，0 条未读" })).toBeTruthy();
});

it("presents notifications as list items and exposes unread state without relying on color", async () => {
  renderBell(1);
  fireEvent.click(await screen.findByRole("button", { name: "通知，1 条未读" }));
  const dialog = await screen.findByRole("dialog", { name: "通知" });
  const list = within(dialog).getByRole("list");
  const items = within(list).getAllByRole("listitem");
  expect(items).toHaveLength(2);
  expect(within(items[0]!).getByLabelText("未读")).toBeTruthy();
  expect(within(items[1]!).queryByLabelText("未读")).toBeNull();
  expect(within(items[0]!).getByText("标为已读")).toBeTruthy();
});
