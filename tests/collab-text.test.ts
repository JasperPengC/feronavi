import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { applyTextValue } from "../src/client/lib/collab-text.ts";

describe("协作正文局部编辑", () => {
  it("只修改变化区间并保留文本其他部分", () => {
    const doc = new Y.Doc();
    const text = doc.getText("content");
    text.insert(0, "alpha beta gamma");
    applyTextValue(text, "alpha BETA gamma");
    expect(text.toString()).toBe("alpha BETA gamma");
  });

  it("重复应用相同值不产生新 update", () => {
    const doc = new Y.Doc();
    const text = doc.getText("content");
    text.insert(0, "stable");
    let updates = 0;
    doc.on("update", () => updates++);
    applyTextValue(text, "stable");
    expect(updates).toBe(0);
  });
});
