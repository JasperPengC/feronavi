# feronavi-mcp

把 Feronavi 的 MCP 能力接到任意支持 MCP 的 AI 客户端。

它**不需要**本地运行 Feronavi 仓库，也**不需要**写 skills 说明：
客户端启动本进程后，工具列表、参数说明全部来自 Feronavi 服务端。

## 用法

```bash
npx -y feronavi-mcp --url https://feronavi.example.com --token fero_xxx
```

或使用环境变量：

```bash
FERONAVI_URL=https://feronavi.example.com \
FERONAVI_TOKEN=fero_xxx \
npx -y feronavi-mcp
```

令牌在 **Feronavi → API 令牌** 创建，建议用只读档位。
服务端必须允许该机器访问 `https://<host>/api/v1/mcp`。

## 客户端配置

### Codex（桌面应用 / CLI）

在 `~/.codex/config.toml` 添加以下配置，然后在 Codex 中重新连接 MCP：

```toml
[mcp_servers.feronavi]
command = "npx"
args = ["-y", "feronavi-mcp"]

[mcp_servers.feronavi.env]
FERONAVI_URL = "https://feronavi.example.com"
FERONAVI_TOKEN = "fero_xxx"
```

也可以用 `feronavi-mcp --print-config --client codex` 生成 TOML。模型供应商配置与 Feronavi 的 API 令牌分别设置。

### Claude Desktop

`claude_desktop_config.json`：

```json
{
  "mcpServers": {
    "feronavi": {
      "command": "npx",
      "args": ["-y", "feronavi-mcp"],
      "env": {
        "FERONAVI_URL": "https://feronavi.example.com",
        "FERONAVI_TOKEN": "fero_xxx"
      }
    }
  }
}
```

### Cursor

`.cursor/mcp.json`：

```json
{
  "mcpServers": {
    "feronavi": {
      "command": "npx",
      "args": ["-y", "feronavi-mcp"],
      "env": {
        "FERONAVI_URL": "https://feronavi.example.com",
        "FERONAVI_TOKEN": "fero_xxx"
      }
    }
  }
}
```

### VS Code

`.vscode/mcp.json`：

```json
{
  "servers": {
    "feronavi": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "feronavi-mcp"],
      "env": {
        "FERONAVI_URL": "https://feronavi.example.com",
        "FERONAVI_TOKEN": "fero_xxx"
      }
    }
  }
}
```

### Windsurf / Cline

两者都兼容 `mcpServers` 结构；`feronavi-mcp --print-config --client windsurf` 可直接生成。

```bash
npx -y feronavi-mcp --print-config --client windsurf \
  --url https://feronavi.example.com --token fero_xxx
```

## 生成配置

```bash
npx -y feronavi-mcp --print-config --client codex \
  --url https://feronavi.example.com --token fero_xxx
```

## 安全

- `--client` 支持 `codex`、`claude`、`cursor`、`vscode`、`windsurf`、`cline`、`generic`；
- 建议 HTTPS；
- 使用 `READ_ONLY` 或 `READ_WRITE` 档位，不要用 ADMIN；
- 令牌只在客户端配置/环境变量中出现，不要提交到仓库；
- 令牌可在 Feronavi 随时吊销。

## 实现边界

- 本包是 **stdio ↔ Streamable HTTP** 桥，所有工具由 Feronavi 服务端提供；
- 不缓存业务数据；
- 当前服务端 MCP 端点是无状态 POST，桥按请求转发；
- 每个请求默认最多等待 120 秒，可通过 `FERONAVI_REQUEST_TIMEOUT_MS` 设置为 1–600000 毫秒；超时后仍可继续处理后续请求；
- 不自动重放业务写入；超时意味着结果未知，先查询业务状态再决定是否重试；
- 不包含 marketplace 插件审核/发布，客户端集成用 MCP 配置即可。
