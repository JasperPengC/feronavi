import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setLocale, t } from "../src/client/i18n/index.ts";
import { ProductsPanel } from "../src/client/components/project/ProductsPanel.tsx";
import { WorkItemEditor } from "../src/client/components/work-item/WorkItemEditor.tsx";
const product = { id: "product-1", name: "Feronavi", description: "研发协作", version: 3, archivedAt: null, canManage: true, requirementCount: 2 };
beforeEach(() => setLocale("zh-CN"));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function wrap(ui: React.ReactNode) { return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}>{ui}</QueryClientProvider>); }
it("产品加载失败展示重试，不误报没有产品", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({message:"网络故障"}),{status:503})));
  wrap(<ProductsPanel open projectId="p1" canCreate onClose={()=>{}} />);
  expect(await screen.findByText(t("common.loadFailedShort"))).toBeTruthy();
  expect(screen.queryByText("此项目尚未关联产品")).toBeNull();
});
it("产品编辑保留版本基线，冲突时不关闭或丢弃输入", async () => {
  const fetcher=vi.fn(async (_u:RequestInfo|URL,init?:RequestInit)=>new Response(JSON.stringify(init?.method==="PATCH"?{message:"产品已被修改，请刷新后重试"}:{products:[product]}),{status:init?.method==="PATCH"?409:200}));
  vi.stubGlobal("fetch",fetcher);
  wrap(<ProductsPanel open projectId="p1" canCreate onClose={()=>{}} />);
  fireEvent.click(await screen.findByRole("button",{name:"编辑产品：Feronavi"}));
  fireEvent.change(screen.getByLabelText("产品名称"),{target:{value:"我的修改"}});
  fireEvent.click(screen.getByRole("button",{name:"保存",exact:true}));
  expect(await screen.findByText("产品已被修改，请刷新后重试")).toBeTruthy();
  expect((screen.getByLabelText("产品名称") as HTMLInputElement).value).toBe("我的修改");
  const call=fetcher.mock.calls.find(([,i])=>i?.method==="PATCH");
  expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({name:"我的修改",expectedVersion:3});
});
it("需求编辑可选择产品，保存使用既有工作项版本", async () => {
  const fetcher=vi.fn(async (url:RequestInfo|URL,init?:RequestInit)=>new Response(JSON.stringify(String(url).includes('/products')?{products:[product]}:init?.method==="PATCH"?{id:"w1"}:{members:[],rows:[]})));
  vi.stubGlobal("fetch",fetcher);
  wrap(<WorkItemEditor open projectId="p1" workItem={{id:"w1",projectId:"p1",type:"REQUIREMENT",title:"需求",description:"",priority:null,assigneeId:null,dueDate:null,version:4}} onClose={()=>{}} />);
  const selector = await screen.findByRole("button",{name:"归属产品"});
  await waitFor(() => expect((selector as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(selector);
  fireEvent.click(await screen.findByRole("option",{name:"Feronavi"}));
  fireEvent.click(screen.getByRole("button",{name:"保存",exact:true}));
  await waitFor(()=>expect(fetcher.mock.calls.some(([,i])=>i?.method==="PATCH")).toBe(true));
  expect(JSON.parse(String(fetcher.mock.calls.find(([,i])=>i?.method==="PATCH")?.[1]?.body))).toMatchObject({productId:"product-1",version:4});
});
it("不能解除的产品不展示解除入口", async () => {
  vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({products:[{...product,requirementCount:0,canUnlink:false}]}))));
  wrap(<ProductsPanel open projectId="p1" canCreate onClose={()=>{}} />);
  await screen.findByText("Feronavi",{exact:true});
  expect(screen.queryByRole("button",{name:t("product.unlink"),exact:true})).toBeNull();
});
it("快速重复提交只创建一次产品", async () => {
  const fetcher=vi.fn(async (_u:RequestInfo|URL,init?:RequestInit)=>init?.method==="POST"?new Promise<Response>(()=>{}):new Response(JSON.stringify({products:[]})));
  vi.stubGlobal("fetch",fetcher);
  wrap(<ProductsPanel open projectId="p1" canCreate onClose={()=>{}} />);
  fireEvent.click(await screen.findByRole("button",{name:t("product.create"),exact:true}));
  const name=screen.getByLabelText("产品名称");
  fireEvent.change(name,{target:{value:"一次创建"}});
  const form=name.closest("form")!;
  act(()=>{form.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));form.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));});
  await waitFor(()=>expect(fetcher.mock.calls.filter(([,i])=>i?.method==="POST")).toHaveLength(1));
});
