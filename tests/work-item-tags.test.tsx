import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { WorkItemTag } from "../src/client/components/work-item/WorkItemTag.tsx";
afterEach(cleanup);
it("保留自定义状态原名，并区分终结成功与取消/拒绝", () => {
  render(<><WorkItemTag kind="status" value="TERMINAL" stateKey="DONE" label="交付完成" />
    <WorkItemTag kind="status" value="TERMINAL" stateKey="REJECTED" label="未采纳" />
    <WorkItemTag kind="status" value="IN_PROGRESS" stateKey="WAITING_REVIEW" label="待同事评审" /></>);
  expect(screen.getByText("交付完成").getAttribute("data-tone")).toBe("success");
  expect(screen.getByText("未采纳").getAttribute("data-tone")).toBe("neutral");
  expect(screen.getByText("待同事评审").getAttribute("data-tone")).toBe("warning");
});
it("未知优先级保持原值，不猜成普通或紧急", () => {
  render(<WorkItemTag kind="priority" value="CUSTOM" />);
  expect(screen.getByText("CUSTOM").getAttribute("data-tone")).toBe("neutral");
});
