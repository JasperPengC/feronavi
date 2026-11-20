import { beforeEach, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({ options: vi.fn(), layout: vi.fn(), terminate: vi.fn() }));
vi.mock("elkjs/lib/elk-api.js", () => ({ default: class {
  constructor(options: unknown) { mocked.options(options); }
  layout(...args: unknown[]) { return mocked.layout(...args); }
  terminateWorker = mocked.terminate;
} }));
vi.mock("elkjs/lib/elk-worker.min.js?url", () => ({ default: "/assets/elk-worker.js" }));
import MermaidELK from "../src/client/lib/mermaid-elk.ts";

beforeEach(() => { mocked.options.mockClear(); mocked.layout.mockReset(); mocked.terminate.mockClear(); });
it("ELK保留算法参数，在独立Worker完成布局后释放线程", async () => {
  const graph = { id: "root", children: [{ id: "a", width: 20, height: 30, intersect: () => {}, element: document.createElement("div") }] };
  const serializable = { id: "root", children: [{ id: "a", width: 20, height: 30 }] };
  mocked.layout.mockResolvedValue(serializable);
  const elk = new MermaidELK({ algorithms: ["layered", "force"] });
  expect(await elk.layout(graph)).toEqual(serializable);
  expect(mocked.layout).toHaveBeenCalledWith(serializable, undefined);
  expect(mocked.options).toHaveBeenCalledWith({ algorithms: ["layered", "force"], workerUrl: "/assets/elk-worker.js" });
  expect(mocked.terminate).toHaveBeenCalledOnce();
});
it("布局失败也释放Worker并保留原错误用于图表降级", async () => {
  const failure = new Error("layout failed"); mocked.layout.mockRejectedValue(failure);
  await expect(new MermaidELK().layout({ id: "root" })).rejects.toBe(failure);
  expect(mocked.terminate).toHaveBeenCalledOnce();
});
