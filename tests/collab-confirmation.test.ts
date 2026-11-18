import { describe, expect, it } from "vitest";
import { DomainError, ERROR_CODES } from "../src/shared/errors.ts";
import { requireUserConfirmation } from "../src/server/services/collab-room.service.ts";

describe("协作写入确认", () => {
  it("没有显式用户确认时拒绝发布并使用稳定错误码", () => {
    expect(ERROR_CODES).toContain("COMMAND_CONFIRMATION_REQUIRED");
    try {
      requireUserConfirmation(false);
      throw new Error("应拒绝未确认的写操作");
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).code).toBe("COMMAND_CONFIRMATION_REQUIRED");
    }
    expect(() => requireUserConfirmation(true)).not.toThrow();
  });
});
