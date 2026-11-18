/** IM 自建应用消息协议（Round 88）：请求形态与响应解析（纯函数；不触网） */
import { describe, it, expect } from "vitest";
import {
  dingtalkSendRequest, dingtalkTokenRequest, feishuSendRequest, feishuTokenRequest,
  sendErrorFromResponse, tokenFromResponse, wecomSendRequest, wecomTokenRequest,
} from "../src/shared/im-app-protocol.ts";

const creds = { appKey: "ak", appSecret: "as", corpId: "corp", agentId: "1001" };

describe("IM 应用消息协议", () => {
  it("钉钉：token 查询 + 工作通知请求体", () => {
    const t = dingtalkTokenRequest(creds);
    expect(t.url).toContain("/gettoken?appkey=ak&appsecret=as");
    const s = dingtalkSendRequest(creds, ["u1", "u2"], "hello", "tok");
    expect(s.url).toContain("/topapi/message/corpconversation/asyncsend_v2?access_token=tok");
    expect(JSON.parse(s.init.body!)).toEqual({ agent_id: 1001, userid_list: "u1,u2", msg: { msgtype: "text", text: { content: "hello" } } });
  });
  it("企微：token 使用 corpId/secret + 应用消息请求体", () => {
    const t = wecomTokenRequest(creds);
    expect(t.url).toContain("/cgi-bin/gettoken?corpid=corp&corpsecret=as");
    const s = wecomSendRequest(creds, ["u1", "u2"], "hello", "tok");
    expect(JSON.parse(s.init.body!)).toEqual({ touser: "u1|u2", msgtype: "text", agentid: 1001, text: { content: "hello" } });
  });
  it("飞书：tenant token + 每条消息一个 open_id/Bearer", () => {
    const t = feishuTokenRequest(creds);
    expect(t.url).toContain("/open-apis/auth/v3/tenant_access_token/internal");
    expect(JSON.parse(t.init.body!)).toEqual({ app_id: "ak", app_secret: "as" });
    const s = feishuSendRequest("ou_1", "hello", "tok");
    expect(s.url).toContain("/open-apis/im/v1/messages?receive_id_type=open_id");
    expect(s.init.headers.authorization).toBe("Bearer tok");
    expect(JSON.parse(s.init.body!)).toEqual({ receive_id: "ou_1", msg_type: "text", content: JSON.stringify({ text: "hello" }) });
  });
  it("token 响应解析：成功/错误码/缺字段", () => {
    expect(tokenFromResponse("DINGTALK", { access_token: "t", errcode: 0 })).toEqual({ token: "t", error: null });
    expect(tokenFromResponse("WECOM", { errcode: 40013, errmsg: "invalid corpid" }).error).toContain("40013");
    expect(tokenFromResponse("FEISHU", { code: 0, tenant_access_token: "ft" }).token).toBe("ft");
    expect(tokenFromResponse("FEISHU", { code: 99991663, msg: "bad" }).error).toContain("99991663");
    expect(tokenFromResponse("DINGTALK", {}).token).toBeNull();
  });
  it("发送响应错误码解析", () => {
    expect(sendErrorFromResponse("DINGTALK", { errcode: 0 })).toBeNull();
    expect(sendErrorFromResponse("WECOM", { errcode: 81013, errmsg: "no user" })).toContain("81013");
    expect(sendErrorFromResponse("FEISHU", { code: 230001, msg: "invalid receive_id" })).toContain("230001");
  });
});
