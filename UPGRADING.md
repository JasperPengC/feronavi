# 0.3.0 安装、升级与恢复

以下步骤面向 0.3.0 目标版本。执行前请在[正式版本页](https://github.com/JasperPengC/feronavi/releases)确认目标镜像和配套包已发布；README 的默认安装入口固定到已发布的 0.2.1，不可混作 0.3.0 安装文件。

Feronavi 是自托管软件。0.3.0 面向软件研发团队，包含需求正文版本与变更影响、正式测试与缺陷复测、交付证据和发布门禁、文档目录，以及当前 Codex 的业务读写闭环。

应用镜像版本为 `0.3.0`；数据库镜像继续使用 `16-0.2.0`（PostgreSQL 16）；stdio 桥接包为 `feronavi-mcp@0.1.1`。桥接器独立编号，工具定义与权限来自服务端。当前镜像验收平台是 Linux amd64；其他架构请先自行演练。

## 全新安装

确认 0.3.0 正式发布后，从该版本下载 `compose.yaml`，生成 `.env` 中的 `DB_PASSWORD`，执行 `docker compose up -d --wait`。默认仅绑定本机 `127.0.0.1:3000`；远程服务器可以先使用 SSH 转发：

```bash
ssh -L 3000:127.0.0.1:3000 user@your-server
```

在本机打开 `http://127.0.0.1:3000/setup` 完成组织和管理员初始化。首次登录会要求修改管理员密码；改密后重新登录。对团队开放使用时配置 HTTPS 反向代理和 WebSocket 转发，不要直接暴露数据库和缓存。

首次业务操作建议按以下顺序：创建项目与成员→创建需求并拆成任务→发布项目文档→建立测试用例与计划→创建仅限此项目的 API 令牌→连接 Codex 并要求读取任务、回写进展和复读确认。RAG 需要另行配置嵌入模型并完成索引；没有模型时可以正常使用项目、任务、文档和测试功能。

## 从 0.2.1 升级

保留原 Compose 目录、项目名、`.env`、数据库卷和应用数据卷；不执行 `down --volumes`，不重新初始化业务数据。新版本首次启动自动应用迁移。迁移后旧需求会捕获为 `BASELINE` 正文版本，表示升级时的当前内容，不伪造原始编辑历史。

默认需求流程的“已验证”修正为完成类别，正常验收后可进入版本完成门禁。迁移只匹配未改动的原默认流程；已有自定义状态、流转或审批保持原样。使用自定义需求流程的项目，请在“项目设置 → 工作流”确认自己的验收终点属于完成类别；不要把仍需后续处理的状态提前设为完成。

1. 记录当前镜像 ID 和版本，安排短暂维护窗口，暂停写入。
2. 停止 `app` 和 `worker`，备份数据库及整个 `/data` 卷。主密钥、附件、安装状态必须与数据库来自同一备份窗口。
3. 在 `.env` 设置 `FERONAVI_VERSION=0.3.0`，保留 `FERONAVI_DB_VERSION=16-0.2.0` 和原数据库密码。
4. 执行 `docker compose pull app worker`、`docker compose up -d --wait`。
5. 检查 `/health` 返回 `ok: true` 和 `database: ok`，检查 `/api/v1/system/status` 的版本；登录后读取旧需求、文档、附件，再检查原 API 令牌、目录与检索。模型索引需要后台重建时，等重建完成后再验收检索。

Linux 主机上的停写备份示例（在原 Compose 目录执行）：

```bash
backup_dir="$(pwd)/backups/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$backup_dir"
chmod 700 "$backup_dir"
docker compose stop app worker
docker compose exec -T db sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner --no-privileges' > "$backup_dir/database.dump"
docker compose run --rm --no-deps --user 0 --volume "$backup_dir:/backup" --entrypoint tar app -czf /backup/data.tar.gz -C /data .
(cd "$backup_dir" && sha256sum database.dump data.tar.gz > SHA256SUMS)
```

确认每条命令成功、两个归档非空并验证 `sha256sum -c SHA256SUMS` 后再升级。备份目录含敏感配置，应限制访问并复制到独立存储。使用对象存储附件时，同时按该存储的备份策略保存对象；本地 `/data` 备份不包含远端对象。

## 失败回退

迁移失败会阻止应用就绪；先查看日志，排除配置/权限问题。已完成升级时，**不要把旧应用直接接到新 schema**。回退应使用升级前的镜像、数据库备份和应用数据卷快照。

在独立目录/新的 Compose 项目中恢复，保留原实例供排查：

1. 使用原版 `compose.yaml` 与原 `.env`，设置旧应用版本，启动 `db cache`。
2. 把 `database.dump` 复制到这套新数据库容器，用 `pg_restore --single-transaction --exit-on-error --clean --if-exists --no-owner --no-privileges` 恢复到新库。
3. 将 `data.tar.gz` 解压到这套实例的**新**应用数据卷，保留原属主及 `master.key` 的权限；不要覆盖正在运行的目录。
4. 启动旧版 `app worker`，验证登录、原文档/工作项、附件、令牌和模型配置；通过后再切换反向代理。恢复期间不要让两个实例同时接收业务写入或发送外部通知。

仓库提供 `scripts/accept-image-upgrade.mjs`，可用本地已有镜像对上述流程做随机 Compose 项目演练：它初始化旧版、保留账号/文档/需求/令牌/密钥，升级候选镜像，再将备份恢复到另一套旧版实例。它只删除自己创建的测试容器与卷。

## 源码运维工具

需要 Node.js 24 与安装好的项目依赖。`scripts/backup.ts` 生成数据库 custom dump、完整数据目录归档和 SHA-256 清单；`scripts/restore.ts` 接受这一格式。上述手工 Compose 备份是另一种归档布局，应按手工步骤恢复，不能混用。

```bash
# DATABASE_URL / DATA_DIR 由自己的运维环境提供；停止 app/worker 后执行
node scripts/backup.ts --out /safe-backups
# 显式指定一个不同的目标数据库和新的空数据目录
RESTORE_DATABASE_URL='postgres://user:password@host:5432/new_database' \
  node scripts/restore.ts --backup /safe-backups/feronavi-backup-TIMESTAMP-ID --data-dir /new-data
```

数据库客户端可用本机 `pg_dump`/`pg_restore`，或设置 `PG_CONTAINER` 使用指定 PostgreSQL 容器内工具。容器模式会连接该容器自己的 `127.0.0.1:5432`，请确保容器与目标库一致。

恢复在数据库写入前校验清单、全部文件哈希，并把附件解包到暂存目录。数据库恢复使用事务；成功后才切换数据目录。非空目标目录默认拒绝；显式 `--force` 会保留原目录为 `.before-restore-*` 后整体替换。数据库与文件系统之间没有分布式事务：若数据库恢复成功但目录切换失败，工具会报错并保留已验证的暂存数据，此时不要启动服务，先完成目录切换。

## 本地复验

使用专用、允许创建临时数据库的 `TEST_DATABASE_ADMIN_URL`，不要指向生产管理账号。验收 runner 会创建随机数据库并在退出时清理。

```bash
npm run test:product-upgrade
PG_CONTAINER=your-test-postgres npm run test:upgrade-restore
npm run test:system-backup-full
DEPLOY_IMAGE=your-local-candidate node scripts/accept-image-upgrade.mjs
```

本地演练证明指定环境与构建的行为；它不替代你部署环境的备份，也不代表 GitHub CI、远端部署或包仓库已经发布成功。
