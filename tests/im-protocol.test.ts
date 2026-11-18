/** IM 协议纯函数（Round 76） */
import { describe, it, expect } from "vitest";
import { buildImPayload, imResponseError } from "../src/shared/im-protocol.ts";

describe("IM provider 消息体", () => {
  it("飞书使用 msg_type/content.text", () => {
    expect(buildImPayload("FEISHU", "hello")).toEqual({ msg_type: "text", content: { text: "hello" } });
  });
  it("钉钉使用 msgtype/text.content", () => {
    expect(buildImPayload("DINGTALK", "hello")).toEqual({ msgtype: "text", text: { content: "hello" } });
  });
  it("企业微信使用 msgtype/text.content", () => {
    expect(buildImPayload("WECOM", "hello")).toEqual({ msgtype: "text", text: { content: "hello" } });
  });
  it("三方错误码都能识别，0 视为成功", () => {
    expect(imResponseError({ code: 0 })).toBeNull();
    expect(imResponseError({ errcode: 40001, errmsg: "bad" })).toContain("40001");
    expect(imResponseError({ StatusCode: 1, msg: "x" })).toContain("1");
  });
});
