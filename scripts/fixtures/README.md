# 系统迁移 v1 固定兼容夹具

这两个 `.fnbak` 是固定提交的 `feronavi-system-backup/1` 字节，不来自任何实际实例。所有 UUID、组织、账号、内容和秘密均为自动测试专用合成数据，域名使用 `example.invalid`。账号 `fixture_unusable` 的固定测试哈希形如 Argon2，但 `m=1` 小于算法最低内存要求，密码验证必败，不能用于登录；full 的 `not-a-valid-token-hash` 不能用于 Token 鉴权。

包密码：`migration-password-123`。full 只迁移测试设置 `smtp.password`，明文为 `fixture-secret`；源主密钥是 32 个字节 `0x07`，绝不可用于真实部署。目标必须使用独立生成的主密钥，当前导入器须把秘密重加密。

| 文件                          | SHA-256                                                            |
| ----------------------------- | ------------------------------------------------------------------ |
| `system-backup-v1-safe.fnbak` | `cf40bc159ba35fda8962d5a77588eeef1074e4fb97cfcb2e008e280ad45381dc` |
| `system-backup-v1-full.fnbak` | `59d9bc252e8d728f8ebc99faef622f32353017343c3658051d2a15a17899be76` |

正常 `pnpm test:system-backup` 只读取这些固定归档，再通过当前真实 HTTP 上传、预检、确认和 worker 导入；不会生成或覆盖夹具。因此后续格式变化会受到已提交 v1 字节的独立回归约束。

只有显式维护夹具时才设置 `GENERATE_SYSTEM_BACKUP_FIXTURES=1`，经隔离 runner 执行总验收入口。生成器使用固定合成 UUID、固定时间戳与无效凭据，随机 salt/nonce 只在这一显式步骤产生。更新夹具必须人工审查字节摘要及兼容性影响，并同步本表；测试运行不会更新摘要。

生成命令（必须指向专用测试 PostgreSQL 管理库）：

```sh
TEST_DATABASE_ADMIN_URL='<isolated-test-admin-url>' GENERATE_SYSTEM_BACKUP_FIXTURES=1 node scripts/run-isolated-test.ts scripts/e2e-system-backup.ts
```

源、safe/full 目标、每项故障、每个固定夹具目标都使用随机数据库与独立 `DATA_DIR`，在 finally 清理。既有项目故障保留其原有项目/成员；其他故障断言没有导入业务数据。目标本地恢复安全审计、控制记录、队列任务和真实重建派生数据均保留，不以删除本地历史换取计数相等。
