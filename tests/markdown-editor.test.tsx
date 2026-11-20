import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { MarkdownEditor } from "../src/client/components/ui/MarkdownEditor.tsx";
import { draftImageTokens, useMarkdownImages, withoutDraftImages } from "../src/client/lib/useMarkdownImages.ts";
import { ActorContext } from "../src/client/lib/actor.ts";
import { saveNewWorkItem, type CreatedWorkItemDraft } from "../src/client/lib/save-work-item.ts";
import { setLocale } from "../src/client/i18n/index.ts";

let objectId = 0;
beforeEach(() => {
  setLocale("zh-CN");
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => `blob:preview-${++objectId}`) });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("代码示例和普通文本中的 draft-image 字样不会被改写或触发上传", async () => {
  const text = "说明 draft-image:abc\n\n`![示例](draft-image:abc)`\n\n```md\n![示例](draft-image:def)\n```";
  expect(withoutDraftImages(text)).toBe(text);
  expect(draftImageTokens(text)).toEqual([]);
  const { result } = renderHook(useMarkdownImages);
  expect(await result.current.persist(text, "WORK_ITEM", "w1")).toBe(text);
});

it.each([
  "```markdown\n![示例](draft-image:abc)",
  "    ![示例](draft-image:abc)",
  "\\![示例](draft-image:abc)",
])("Markdown 代码或转义内容保持原样：%s", async (text) => {
  expect(withoutDraftImages(text)).toBe(text);
  expect(draftImageTokens(text)).toEqual([]);
  const { result } = renderHook(useMarkdownImages);
  expect(await result.current.persist(text, "WORK_ITEM", "w1")).toBe(text);
});

it("仅可创建和上传、不可更新的角色在创建前得到明确限制", () => {
  const wrapper = ({ children }: { children: React.ReactNode }) => <ActorContext.Provider value={{
    memberId: "member", username: "member", name: "member", permissions: ["work_item:create", "attachment:upload"],
    dataScopes: [], mustChangePassword: false, locale: "zh-CN", theme: null, timezone: null,
  }}>{children}</ActorContext.Provider>;
  const { result } = renderHook(() => useMarkdownImages({ newWorkItem: true }), { wrapper });
  expect(result.current.disabledReason).toContain("编辑自己创建");
  act(() => { expect(result.current.stage([png()])).toBe(""); });
  expect(result.current.images).toHaveLength(0);
});

function Harness({ disabled = false }: { disabled?: boolean }) {
  const [value, setValue] = useState("前文后文");
  const images = useMarkdownImages();
  return <MarkdownEditor label="描述" value={value} onChange={setValue} images={images} disabled={disabled} />;
}
const png = (name = "截图.png") => new File(["image bytes"], name, { type: "image/png" });

it("截图粘贴到光标处，保留前后文和随后输入，预览使用本地图片", () => {
  render(<Harness />);
  const input = screen.getByRole("textbox", { name: "描述" }) as HTMLTextAreaElement;
  input.focus(); input.setSelectionRange(2, 2);
  fireEvent.paste(input, { clipboardData: { files: [png()], getData: () => "" } });
  expect(input.value).toMatch(/^前文\n\n!\[截图.png\]\(draft-image:[a-f0-9-]+\)\n\n后文$/u);
  fireEvent.change(input, { target: { value: `${input.value}继续补充` } });
  fireEvent.click(screen.getByRole("button", { name: "预览", exact: true }));
  expect(screen.getByRole("region", { name: "正文预览" }).textContent).toContain("继续补充");
  expect(screen.getByRole("img", { name: "截图.png" }).getAttribute("src")).toMatch(/^blob:/u);
  expect(screen.getByText("保存时上传")).toBeTruthy();
});

it("协作文档上传完成后才插入可共享地址，并保留上传期间收到的远端正文", async () => {
  let finish: (response: Response) => void = () => {};
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
  function SharedEditor() {
    const [value, setValue] = useState("正文");
    const images = useMarkdownImages();
    return <><button onClick={() => setValue("正文，远端新增")}>远端更新</button><MarkdownEditor label="协作正文" value={value} onChange={setValue} images={images} imageTarget={{ type: "PAGE", id: "page-1" }} /></>;
  }
  render(<SharedEditor />);
  const input = screen.getByRole("textbox", { name: "协作正文" }) as HTMLTextAreaElement;
  fireEvent.change(screen.getByLabelText("选择正文图片"), { target: { files: [png()] } });
  expect(input.value).toBe("正文");
  expect(input.value).not.toContain("draft-image:");
  fireEvent.click(screen.getByRole("button", { name: "远端更新" }));
  await act(async () => finish(new Response(JSON.stringify({ id: "image-1" }), { status: 200 })));
  await waitFor(() => expect(input.value).toContain("/api/v1/attachments/image-1/preview"));
  expect(input.value).toContain("远端新增");
  expect(input.value).not.toContain("draft-image:");
});

it("协作图片上传结束时不会把图片地址插入仍有焦点的标题框", async () => {
  let finish: (response: Response) => void = () => {};
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
  const previous = Object.getOwnPropertyDescriptor(document, "execCommand");
  const nativeInsert = vi.fn((_command: string, _ui: boolean, text: string) => {
    const focused = document.activeElement as HTMLInputElement | HTMLTextAreaElement;
    focused.value += text;
    return true;
  });
  Object.defineProperty(document, "execCommand", { configurable: true, value: nativeInsert });
  function SharedEditor() {
    const [value, setValue] = useState("正文");
    const images = useMarkdownImages();
    return <><input aria-label="文档标题" defaultValue="原始标题" /><MarkdownEditor label="协作正文" value={value} onChange={setValue} images={images} imageTarget={{ type: "PAGE", id: "page-1" }} /></>;
  }
  try {
    render(<SharedEditor />);
    const title = screen.getByRole("textbox", { name: "文档标题" }) as HTMLInputElement;
    const input = screen.getByRole("textbox", { name: "协作正文" }) as HTMLTextAreaElement;
    title.focus();
    fireEvent.change(screen.getByLabelText("选择正文图片"), { target: { files: [png()] } });
    expect(input.disabled).toBe(true);
    await act(async () => finish(new Response(JSON.stringify({ id: "image-1" }), { status: 200 })));
    expect(title.value).toBe("原始标题");
    await waitFor(() => expect(input.value).toContain("/api/v1/attachments/image-1/preview"));
    expect(input.value).toContain("正文");
  } finally {
    if (previous) Object.defineProperty(document, "execCommand", previous);
    else Reflect.deleteProperty(document, "execCommand");
  }
});

it("普通文字粘贴不被拦截，文件拖放逐项校验并保留有效图片", () => {
  render(<Harness />);
  const input = screen.getByRole("textbox", { name: "描述" }) as HTMLTextAreaElement;
  expect(fireEvent.paste(input, { clipboardData: { files: [], getData: () => "纯文本" } })).toBe(true);
  const huge = png("太大.png");
  Object.defineProperty(huge, "size", { value: 21 * 1024 * 1024 });
  fireEvent.drop(input, { dataTransfer: { files: [png(), new File(["log"], "日志.txt", { type: "text/plain" }), huge], types: ["Files"] } });
  expect(input.value.match(/draft-image:/gu)).toHaveLength(1);
  expect(screen.getByRole("alert").textContent).toContain("日志.txt");
  expect(screen.getByRole("alert").textContent).toContain("太大.png");
  expect(screen.getByRole("alert").textContent).toContain("20 MB");
});

it("预览只读，拒绝文件拖放和残留输入事件，切回编辑后恢复图片操作", () => {
  render(<Harness />);
  const input = screen.getByRole("textbox", { name: "描述" }) as HTMLTextAreaElement;
  fireEvent.paste(input, { clipboardData: { files: [png()], getData: () => "" } });
  const draft = input.value;
  fireEvent.click(screen.getByRole("button", { name: "预览", exact: true }));
  const preview = screen.getByRole("region", { name: "正文预览" });
  expect(screen.queryByRole("group", { name: "正文工具" })).toBeNull();
  expect(screen.queryByRole("button", { name: "插入图片" })).toBeNull();
  expect(screen.queryByRole("button", { name: "移除截图.png" })).toBeNull();
  expect(screen.getByText("预览为只读，切回“编辑”修改内容。")).toBeTruthy();
  const transfer = { files: [png("预览拖放.png")], types: ["Files"], dropEffect: "copy" };
  expect(fireEvent.dragEnter(preview, { dataTransfer: transfer })).toBe(false);
  fireEvent.dragOver(preview, { dataTransfer: transfer });
  expect(transfer.dropEffect).toBe("none");
  expect(screen.queryByText("松开即可插入图片")).toBeNull();
  expect(fireEvent.drop(preview, { dataTransfer: transfer })).toBe(false);
  fireEvent.paste(input, { clipboardData: { files: [png("预览粘贴.png")], getData: () => "" } });
  fireEvent.keyDown(input, { key: "b", ctrlKey: true });
  fireEvent.change(input, { target: { value: "预览期间不应改变正文" } });
  fireEvent.change(screen.getByLabelText("选择正文图片"), { target: { files: [png("预览选择.png")] } });
  expect(input.value).toBe(draft);
  expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "预览", exact: true }).getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "编辑", exact: true }));
  expect(screen.getByRole("button", { name: "插入图片" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "移除截图.png" }));
  expect(input.value).not.toContain("draft-image:");
  fireEvent.drop(input, { dataTransfer: transfer });
  expect(input.value).toContain("预览拖放.png");
});

it("移除图片不上传；恢复 Markdown 引用仍能预览，卸载释放预览资源", async () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  const { unmount } = render(<Harness />);
  const input = screen.getByRole("textbox", { name: "描述" }) as HTMLTextAreaElement;
  fireEvent.paste(input, { clipboardData: { files: [png()], getData: () => "" } });
  const withImage = input.value;
  fireEvent.click(screen.getByRole("button", { name: "移除截图.png" }));
  expect(input.value).not.toContain("draft-image:");
  fireEvent.change(input, { target: { value: withImage } });
  expect(screen.getByText("截图.png")).toBeTruthy();
  expect(fetcher).not.toHaveBeenCalled();
  unmount(); expect(URL.revokeObjectURL).toHaveBeenCalled();
});

it("保存期间拒绝拖入和粘贴图片", () => {
  render(<Harness disabled />);
  const input = screen.getByRole("textbox", { name: "描述" }) as HTMLTextAreaElement;
  fireEvent.drop(input, { dataTransfer: { files: [png()], types: ["Files"] } });
  fireEvent.paste(input, { clipboardData: { files: [png()], getData: () => "" } });
  expect(input.value).toBe("前文后文");
});

it("图片说明包含本地地址或地址有实体编码时，只替换图片目标并保留说明", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: "image-id" }), { status: 201 })));
  const { result } = renderHook(useMarkdownImages);
  let staged = "";
  act(() => { staged = result.current.stage([png()]); });
  const token = draftImageTokens(staged)[0]!;
  const text = `前文\n![${token}](${token} "图片说明")\n![实体编码](${token.replace("draft", "dr&#97;ft")})`;
  let resolved = "";
  await act(async () => { resolved = await result.current.persist(text, "WORK_ITEM", "w1"); });
  expect(resolved).toBe(`前文\n![${token}](/api/v1/attachments/image-id/preview "图片说明")\n![实体编码](/api/v1/attachments/image-id/preview)`);
  expect(draftImageTokens(resolved)).toEqual([]);
});

it("上传部分失败后重试复用成功附件，不丢失正文，不持久化临时 URL", async () => {
  let uploads = 0;
  const fetcher = vi.fn(async () => {
    uploads++;
    return new Response(JSON.stringify(uploads === 2 ? { code: "INTERNAL", message: "网络断开" } : { id: `att-${uploads}` }), { status: uploads === 2 ? 500 : 201 });
  });
  vi.stubGlobal("fetch", fetcher);
  const { result } = renderHook(useMarkdownImages);
  let text = "";
  act(() => { text = `说明\n${result.current.stage([png("one.png"), png("two.png")])}\n结尾`; });
  await act(async () => { await expect(result.current.persist(text, "WORK_ITEM", "w1")).rejects.toThrow("网络断开"); });
  let saved = "";
  await act(async () => { saved = await result.current.persist(text, "WORK_ITEM", "w1"); });
  expect(uploads).toBe(3);
  expect(saved).toContain("/api/v1/attachments/att-1/preview");
  expect(saved).toContain("/api/v1/attachments/att-3/preview");
  expect(saved).not.toContain("draft-image:");
  expect(saved).toContain("结尾");
  const form = fetcher.mock.calls[0]; expect(form).toBeTruthy();
});

it("创建成功而图片失败后继续保存同一工作项，使用创建时版本且不重复创建", async () => {
  const requests: { url: string; method?: string; body: unknown }[] = [];
  const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(url), method: init?.method, body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify({ id: "new-id", version: init?.method === "PATCH" ? 2 : 1 }), { status: 200 });
  });
  vi.stubGlobal("fetch", fetcher);
  const session: { current: CreatedWorkItemDraft | null } = { current: null };
  const body = { type: "TASK", title: "截图任务", description: "步骤\n\n![截图](draft-image:abc)" };
  const persist = vi.fn().mockRejectedValueOnce(new Error("断网")).mockResolvedValueOnce("步骤\n\n![截图](/api/v1/attachments/image/preview)");
  await expect(saveNewWorkItem(session, "p1", body, persist)).rejects.toThrow("断网");
  expect(session.current?.id).toBe("new-id");
  await saveNewWorkItem(session, "p1", { ...body, title: "补充后的标题" }, persist);
  expect(requests.filter((r) => r.method === "POST")).toHaveLength(1);
  expect(requests[0]!.body).toMatchObject({ description: "步骤" });
  expect(requests[1]!.url).toContain("/work-items/new-id");
  expect(requests[1]!.body).toMatchObject({ version: 1, title: "补充后的标题" });
  expect(JSON.stringify(requests)).not.toContain("draft-image:");
  expect(withoutDraftImages(body.description)).toBe("步骤");
});
