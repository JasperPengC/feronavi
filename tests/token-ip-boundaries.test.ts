// @vitest-environment node
import { expect, it, vi } from "vitest";
vi.mock("../src/db/index.ts", () => ({ db: {} }));
import { ipAllowed } from "../src/server/services/token.service.ts";
it("IPv6 和非法 IP 不能被按零地址匹配 IPv4 白名单", () => {
  for (const ip of ["::1", "2001:db8::1", "invalid", "256.0.0.1", "1.2.3"]) expect(ipAllowed(ip, ["0.0.0.0/8"]), ip).toBe(false);
});
it("非法 CIDR 不能意外放行地址", () => {
  for (const cidr of ["invalid/0", "256.0.0.1/0", "0.0.0.0/0/24", "0.0.0.0/"]) expect(ipAllowed("203.0.113.7", [cidr]), cidr).toBe(false);
});
it("合法 IPv4 CIDR、单地址与映射地址保持正常匹配", () => {
  expect(ipAllowed("192.0.2.5", ["192.0.2.0/24"])).toBe(true);
  expect(ipAllowed("192.0.3.5", ["192.0.2.0/24"])).toBe(false);
  expect(ipAllowed("::ffff:192.0.2.5", ["192.0.2.5"])).toBe(true);
  expect(ipAllowed(null, [])).toBe(true);
  expect(ipAllowed(null, ["0.0.0.0/0"])).toBe(false);
});
