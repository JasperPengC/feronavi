import { describe, expect, it } from "vitest";
import { attachmentCollabEvent, importCollabEvent } from "../src/server/services/collab-event-payload.ts";

describe("协作业务事件契约", () => {
  it("附件事件包含资源定位和附件摘要", () => {
    expect(attachmentCollabEvent("attachment.uploaded", {
      attachmentId: "att-1", targetType: "PAGE", targetId: "page-1", projectId: "project-1",
      originalName: "设计稿.png", mimeType: "image/png", sizeBytes: 128,
    })).toEqual({
      event: "attachment.uploaded",
      data: expect.objectContaining({ attachmentId: "att-1", targetType: "PAGE", targetId: "page-1", projectId: "project-1" }),
    });
  });

  it("导入事件包含批次状态和统计，不逐工作项广播", () => {
    const result = importCollabEvent("import.completed", {
      batchId: "batch-1", projectId: "project-1", status: "SUCCEEDED", created: 3, skipped: 1, failed: 0,
    });
    expect(result).toEqual({
      event: "import.completed",
      data: { batchId: "batch-1", projectId: "project-1", status: "SUCCEEDED", created: 3, skipped: 1, failed: 0 },
    });
    expect(result.data).not.toHaveProperty("workItemIds");
  });
});
