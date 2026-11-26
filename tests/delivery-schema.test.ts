// @vitest-environment node
import { expect, it } from "vitest";
import { deliverySha, deliveryUrl } from "../src/shared/schemas/delivery.ts";
it("交付SHA只接受完整40或64位哈希，链接拒绝本地路径与内嵌凭据", () => {
  for (const n of [40, 64])
    expect(deliverySha.safeParse("a".repeat(n)).success).toBe(true);
  for (const n of [39, 41, 63, 65])
    expect(deliverySha.safeParse("a".repeat(n)).success).toBe(false);
  for (const url of [
    "/Users/a/log",
    "file:///tmp/log",
    "https://token@example.com/log",
  ])
    expect(deliveryUrl.safeParse(url).success).toBe(false);
});
