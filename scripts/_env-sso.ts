/**
 * SSO 套件专用预载：**必须在导入 url-safety 之前设置**。
 * 该模块在**加载时**读取 `ALLOW_INSECURE_OUTBOUND_HTTP`（常量），模块内再设已经来不及 ——
 * 而本套件要用 `http://127.0.0.1:<随机端口>` 起一个假 IdP（生产环境必须是 https）。
 */
process.env.ALLOW_INSECURE_OUTBOUND_HTTP ??= "1";
