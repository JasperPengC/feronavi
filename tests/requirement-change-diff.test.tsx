import { cleanup,fireEvent,render,screen } from "@testing-library/react";
import { afterEach,expect,it } from "vitest";
import { ChangeDiff } from "../src/client/components/work-item/ChangeDiff.tsx";
import { setLocale,t } from "../src/client/i18n/index.ts";
afterEach(cleanup);
it("变更差异默认只显示改动，能展开完整上下文",()=>{
 setLocale("zh-CN");render(<ChangeDiff label="正文" before={"未改内容\n原规则\n尾部"} after={"未改内容\n新规则\n尾部"} />);
 expect(screen.queryByText(/未改内容/)).toBeNull();expect(screen.getByText(/原规则/)).toBeTruthy();expect(screen.getByText(/新规则/)).toBeTruthy();
 fireEvent.click(screen.getByRole("button",{name:t("change.showContext")}));expect(screen.getByText(/未改内容/)).toBeTruthy();
 fireEvent.click(screen.getByRole("button",{name:t("change.onlyChanges")}));expect(screen.queryByText(/未改内容/)).toBeNull();
});
it("未修改的标题不重复占用差异区",()=>{const {container}=render(<ChangeDiff label="标题" before="相同" after="相同"/>);expect(container.textContent).toBe("");});
