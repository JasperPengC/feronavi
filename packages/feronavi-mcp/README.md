# feronavi-mcp

## 版本兼容

本包 `0.1.1` 与 Feronavi 应用 `0.3.0` 配套验收；源码版本不代表已发布到 npm，请先确认目标包可用。桥接器独立版本号；工具定义、业务能力和权限由连接的 Feronavi 服务端提供。已有 `0.1.0` 连接无需因为服务端新增工具而更改配置，但客户端需要重新加载工具列表。`0.1.1` 正式发布后，可固定 `npx -y feronavi-mcp@0.1.1`，避免自动切换包版本。

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

### 文档引用

写入文档时，链接应使用平台文档地址（`/projects/<projectId>/wiki?page=<pageId>`）、平台返回的附件地址，或真实可访问的仓库网页地址。引用代码时建议固定 commit，避免分支更新后内容变化。

本地路径（如 `/Users/...`、`/home/...`、`C:\...`）和相对文件路径（如 `../guide.md`）只能作为行内代码或代码块展示，不能当作链接或图片目标；不要猜测它们对应的仓库地址。服务端会返回 `VALIDATION`、行号及修改建议，原文档版本不变。协同草稿仍保留，修正后重新发布。

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

### 文档目录与归档

- `page.create` 传 `kind: "FOLDER"` 创建文件夹；`parentId` 指向同项目的上级节点。文件夹没有正文版本、协作房间或 RAG 切片。
- `page.get` 返回 `structureVersion`；`page.organize` 通过 `expectedStructureVersion` 校验重命名、移动、归档和恢复。正文发布继续使用 `expectedRevisionId`，移动不改变文档 ID、引用地址或正文版本。
- `page.list` 默认读取有效文档树，`archived: true` 读取归档内容。归档对子树立即生效，RAG 不再返回归档内容；恢复上级不会撤销子项自己的归档。
- 文件夹仅用于分类，不继承或扩大子文档 ACL。归档/恢复需要整个子树的读取与写入权限，任何一项无权则整体拒绝。冲突后重新读取，不能自行覆盖新版本。

### 产品与需求归属

- 先用 `product.list/get` 读取当前项目的产品、`version`、`canManage` 和 `canUnlink`。`product.create` 创建并关联当前项目，可传 `idempotencyKey` 避免重复创建。
- `product.update/linkProject/unlinkProject` 需要 `expectedVersion`；账号和令牌必须覆盖所有受影响项目。关联产品不会授予项目访问权限。
- `workitem.create/update` 的 `productId` 只用于需求，需已关联同一项目；修改归属使用工作项版本，不增加正文历史版本。归档产品保留原有需求归属，拒绝新挂接。
- 写入须有用户授权并传 `userConfirmed: true`；成功后回读，冲突时重新确认基线。解除项目关联需要没有需求引用（包括软删除记录）且保留至少一个项目。

### 需求变更与影响确认

- 先读 `requirementChange.context`，保存 `baseRevision.id`、`workItemVersion` 和 `impactFingerprint`。`create` 带这三项基线、拟议标题/正文及原因；可用 `idempotencyKey` 防止重复提出。提案不会直接修改需求。
- `decide` 使用变更的 `expectedVersion`；项目管理者可批准或拒绝，提出人或管理者可撤回。OPC 可自行评审，记录真实身份；撤回保留原评审意见。提案不可原地修改，过期需重新提出。
- `apply` 另需当前 `expectedWorkItemVersion`，重新验证正文、影响范围及评审人权限，再同事务保存正文版本。审批通过不等于已应用；不能强制覆盖过期版本。
- 当前影响范围是同项目子任务树、直接关联工作项及其里程碑/迭代/版本，以及关联当前需求的有效测试用例。`get` 返回权限内的固定快照、参与人和确认记录；确认不改变用例原有的需求版本基线。
- 应用后由当前负责人或管理者调用 `acknowledge(impactId, expectedVersion, note)`。确认仅表示已评估，不改变任务完成状态。每次写后用 `get` 和 `workitem.get` 回读；冲突先重读，超时先核验。

### 正式测试用例库

- `testSuite.list/get/create/update`：按项目维护套件，归档前须移走或归档有效用例。
- `testCase.list/get/revisions/getRevision/create/update`：独立用例编号、负责人、优先级、状态和不可变正文版本。`steps` 每步包含 `action` 和 `expected`，`READY` 至少一个完整步骤。
- `requirements` 使用同项目的 `workItemId + revisionId` 固定需求基线；正文、步骤和关联变化产生新 revision，元数据变更只增加 version。历史版本可单独读取。
- 创建支持 `idempotencyKey`；更新需要 `expectedVersion`，冲突先回读。新建/改动关联用例会使尚未应用的需求变更影响快照过期；影响确认不自动改写用例基线。
- 写入沿用真实账号权限、令牌档位及项目白名单；成功重放仍会重验权限。用例归档不删除历史，恢复须目标套件有效。

### 测试执行与复测

- `testPlan.list/get/create/update/transition/report`：草稿选择当前就绪用例的 `caseId + revisionId`，填写 `build` 与 `environment`。开始后固定范围；完成要求每条用例有最终结果，取消须提供原因。
- `testRun.start/get/record/complete`：返回稳定执行 ID；`record` 使用 `expectedVersion` 回写零起索引的 `stepIndex`、结果、实际表现及证据。证据只接受 HTTP(S) 链接，不能填本机路径或带凭据的 URL。
- 复测调用 `start` 并用 `retestOf` 引用最新已结束执行，明确填写本次实际 `build` 与 `environment`；保持同一固定用例版本。每次执行独立保存构建快照。终态不可改写，旧失败记录继续保留。
- `testRun.createDefect/linkDefect`：失败执行原子创建或关联同项目缺陷。每条执行只自动创建一个缺陷；复测成功后仍由原工作流完成缺陷验证和关闭。
- 写工具支持 `idempotencyKey`、用户确认和当前权限复验。REST 写入使用 `Idempotency-Key` 请求头；同一请求的重试沿用同一键，不能把不同操作复用一个键。
- `AGENT` / `AUTOMATION` 来源须填写 `sourceReference`。报告区分全部尝试和每条用例的最新结果；只有计划完成、最新结果全部通过且构建/环境一致时 `passed=true`，`testedBuild/testedEnvironment` 指明实际验收对象；混合构建不判通过。这些是 `SELF_REPORTED` 记录，不能冒充可信 CI 或部署证明。

### Agent 执行记录与接管

- 先创建固定项目的本人会话，再用 `rag.conversation.propose` 登记最多 10 个操作。保存返回的 `requestId` 和每步 `action.id`；登记只生成待审阅提议，业务写入仍走原确认入口。
- 使用 `rag.conversation.execution` 回读整轮与每步结果。审批已提交、已执行但缺回读、结果不确定均有独立状态，不能当作业务已完成；历史回读是执行时快照，当前状态需打开原对象核对。
- 同一请求原样重试沿用相同 ID，不能为重试重新生成请求。发生版本冲突时，读取当前业务对象后调用 `rag.conversation.revise`，传完整新参数与稳定 `replacementId`，保留旧步骤并重新确认。已完成、运行中和结果不确定的步骤不能修正后重做。
- 外层写工具按统一契约传 `userConfirmed: true`；`steps[].parameters` 不接受 `userConfirmed`、`idempotencyKey` 或执行结果。执行和重放都会重验当前权限、项目范围与工具策略。

### 交付证据与发布核验

- 交付证据使用 `delivery.createEvidence` 登记并关联工作项，只接受 HTTP(S) 链接。用户或 Agent 登记始终标注 `SELF_REPORTED`，不能充当可信 CI 或部署证明。
- GitHub 来源由 `delivery.configureSource` 绑定项目集成，使用独立 Webhook 密钥；平台核对签名并读取 GitHub API 后才生成 `PROVIDER_API` 证据。来源配置变化后，旧证据保留但不再满足当前发布核验。
- `delivery.createCandidate` 固定版本范围、来源版本、提交、构建、环境、必需流水线和测试计划；首次 `expectedCandidateNumber=0`，后续传当前编号。GitHub 的构建标识为完整提交 SHA。
- 先读 `delivery.releaseGate`，再通过原 `plan.completeRelease` 完成版本。服务端会重新检查最新 CI、合并、目标环境部署及同构建测试报告；缺证据、失败、范围变动都会阻塞。完成后用 `delivery.recordFeedback` 关联原始反馈链接和工作项，不自动关闭任务。
