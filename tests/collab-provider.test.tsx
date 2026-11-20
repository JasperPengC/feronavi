import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { apiGet, apiPost } from "../src/client/lib/api.ts";
import { useCollabDocument } from "../src/client/lib/collab-provider.ts";
import { createCollabOutbox } from "../src/client/lib/collab-outbox.ts";

vi.mock("../src/client/lib/api.ts", () => ({ apiGet: vi.fn(), apiPost: vi.fn(), ApiError: class extends Error {} }));
const encode = (doc: Y.Doc) => Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64");
let server: Y.Doc;
beforeEach(() => {
  localStorage.clear(); vi.clearAllMocks(); server = new Y.Doc();
  vi.mocked(apiGet).mockImplementation(async path => path.endsWith("/state")
    ? { roomId: "room", sequence: 0, baseRevisionId: "r1", stateBase64: encode(server) }
    : { members: [] });
  vi.mocked(apiPost).mockImplementation(async (path, body) => {
    if (path.endsWith("/updates")) Y.applyUpdate(server, Buffer.from((body as { updateBase64: string }).updateBase64, "base64"));
    return {};
  });
});
afterEach(() => { cleanup(); server.destroy(); });

describe("浏览器协作接入使用服务端Yjs历史", () => {
  it("后加入的编辑者保留未发布草稿，不发送旧正文覆盖", async () => {
    server.getText("content").insert(0, "原始正文，甲的未发布草稿");
    const { result } = renderHook(() => useCollabDocument("p1", "原始正文", true, "user-b"));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.content).toBe("原始正文，甲的未发布草稿");
    expect(vi.mocked(apiPost).mock.calls.filter(([path]) => path.endsWith("/updates"))).toHaveLength(0);
  });
  it("加入后第一条增量可独立应用到服务端，不依赖未发送的bootstrap", async () => {
    server.getText("content").insert(0, "原始正文");
    const { result } = renderHook(() => useCollabDocument("p1", "原始正文", true, "user-a"));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    act(() => result.current.setContent("原始正文，新增内容"));
    await waitFor(() => expect(server.getText("content").toString()).toBe("原始正文，新增内容"));
  });
  it("已被协作者清空的草稿保持为空，不重新插入已发布正文", async () => {
    server.getText("content").insert(0, "原始正文"); server.getText("content").delete(0, 4);
    const { result } = renderHook(() => useCollabDocument("p1", "原始正文", true, "user-c"));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.content).toBe("");
  });
  it("网络请求尚未返回时，后续编辑也立即持久化，不被发送队列阻塞", async () => {
    server.getText("content").insert(0, "正文");
    let release: () => void = () => {};
    const blocked = new Promise<void>(resolve => { release = resolve; });
    vi.mocked(apiPost).mockImplementation(async path => { if (path.endsWith("/updates")) await blocked; return {}; });
    const { result } = renderHook(() => useCollabDocument("p1", "正文", true, "user-a"));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    try {
      act(() => result.current.setContent("正文第一条"));
      act(() => result.current.setContent("正文第一条第二条"));
      const outbox = createCollabOutbox();
      const clientId = localStorage.getItem("feronavi:collab:client:user-a")!;
      await waitFor(async () => expect(await outbox.list("PAGE/p1", clientId)).toHaveLength(2));
    } finally { await act(async () => release()); }
  });
  it("未产生本地修改的离线用户联网后也补取遗漏的远端更新", async () => {
    server.getText("content").insert(0, "正文");
    const { result } = renderHook(() => useCollabDocument("p1", "正文", true, "user-a"));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    server.getText("content").insert(2, "远端离线期间修改");
    act(() => window.dispatchEvent(new Event("online")));
    await waitFor(() => expect(result.current.content).toBe("正文远端离线期间修改"));
  });
  it("同账号的两个编辑窗口使用独立连接身份，关闭其一不离开另一窗口", async () => {
    server.getText("content").insert(0, "正文");
    const first = renderHook(() => useCollabDocument("p1", "正文", true, "user-a"));
    const second = renderHook(() => useCollabDocument("p1", "正文", true, "user-a"));
    await waitFor(() => expect(first.result.current.status).toBe("ready"));
    await waitFor(() => expect(second.result.current.status).toBe("ready"));
    const joined = vi.mocked(apiPost).mock.calls.filter(([path]) => path.endsWith("/join")).map(([, body]) => (body as { clientId: string }).clientId);
    expect(new Set(joined).size).toBe(2);
    first.unmount();
    const leaves = vi.mocked(apiPost).mock.calls.filter(([path]) => path.endsWith("/leave"));
    expect(leaves).toHaveLength(1);
    expect((leaves[0]![1] as { clientId: string }).clientId).not.toBe(joined[1]);
  });
  it("首次连接失败保持只读，网络恢复后加载真实草稿并恢复编辑", async () => {
    server.getText("content").insert(0, "尚未发布的正文");
    const previous = vi.mocked(apiGet).getMockImplementation()!;
    vi.mocked(apiGet).mockRejectedValue(new Error("断网"));
    const { result } = renderHook(() => useCollabDocument("p1", "旧正文", true, "user-a"));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.readyToEdit).toBe(false);
    act(() => result.current.setContent("不应接受未同步的编辑"));
    vi.mocked(apiGet).mockImplementation(previous);
    act(() => window.dispatchEvent(new Event("online")));
    await waitFor(() => expect(result.current.readyToEdit).toBe(true));
    expect(result.current.content).toBe("尚未发布的正文");
  });
});
