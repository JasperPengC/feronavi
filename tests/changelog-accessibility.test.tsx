import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ChangelogPage } from "../src/client/routes/ChangelogPage.tsx";

afterEach(cleanup);

it("让实际滚动的更新日志页面可通过键盘聚焦", () => {
  const { container } = render(<ChangelogPage />);
  const page = container.querySelector<HTMLElement>(".changelog-page");
  expect(page).not.toBeNull();
  expect(page?.getAttribute("tabindex")).toBe("0");
});
