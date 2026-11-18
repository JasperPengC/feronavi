#!/usr/bin/env bash
#
# Feronavi 备份脚本（第十二期）
#
# 规范第 8 章 + 6.4 节：**数据库 + 附件 + 密钥，三者缺一不可**。
#   - 少了数据库：业务数据没了
#   - 少了附件：文件全成死链
#   - 少了密钥（DATA_DIR/master.key）：**敏感设置（SMTP 密码等）的密文永远解不开**
# 这正是"备份看着成功、恢复时才发现解不开"的经典事故，因此本脚本把三者打进同一个归档并校验。
#
# 用法：
#   DATABASE_URL=postgres://... DATA_DIR=/data ./scripts/backup.sh [输出目录]
# 外部数据库场景：本脚本仍可手动执行，但**平台不保证**自动备份（规范要求责任显式转移给部署方）。
set -euo pipefail

OUT_DIR="${1:-./backups}"
STAMP="$(date +%Y%m%d-%H%M%S)"
DATA_DIR="${DATA_DIR:-/tmp/feronavi-data}"
DB_URL="${DATABASE_URL:?需要 DATABASE_URL（外部库场景由部署方自行保证备份）}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "[backup] 1/4 导出数据库…"
# 宿主机有 pg_dump 就直接用；没有则退回容器内的 pg_dump（自托管部署下容器一定有）
if command -v pg_dump >/dev/null 2>&1; then
  # --no-owner/--no-privileges：恢复到不同角色名的实例时不会失败
  pg_dump "$DB_URL" --no-owner --no-privileges -f "$WORK/db.sql"
else
  echo "[backup]   宿主机没有 pg_dump，改用容器内的 pg_dump…"
  # 从 DATABASE_URL 解析出库名与用户（容器内连接不需要密码）
  DB_NAME="${DB_URL##*/}"; DB_NAME="${DB_NAME%%\?*}"
  docker compose exec -T db pg_dump -U feronavi -d "$DB_NAME" --no-owner --no-privileges > "$WORK/db.sql"
fi

echo "[backup] 2/4 打包附件…"
if [ -d "$DATA_DIR/attachments" ]; then
  tar -czf "$WORK/attachments.tar.gz" -C "$DATA_DIR" attachments
else
  echo "[backup]   （没有附件目录，跳过）"
  : > "$WORK/attachments.missing"
fi

echo "[backup] 3/4 打包密钥…"
if [ -f "$DATA_DIR/master.key" ]; then
  # ⚠️ 权限收紧：密钥是解密的唯一凭据
  cp "$DATA_DIR/master.key" "$WORK/master.key"
  chmod 600 "$WORK/master.key"
else
  echo "[backup]   ⚠️ 未找到 master.key —— 若已有敏感设置，恢复后无法解密！" >&2
  : > "$WORK/master.missing"
fi

echo "[backup] 4/4 生成归档与校验和…"
mkdir -p "$OUT_DIR"
ARCHIVE="$OUT_DIR/feronavi-backup-$STAMP.tar.gz"
tar -czf "$ARCHIVE" -C "$WORK" .
# 校验和单独落盘：恢复前先验完整性
shasum -a 256 "$ARCHIVE" | awk '{print $1}' > "$ARCHIVE.sha256"

cat <<EOF

[backup] 完成：$ARCHIVE
[backup] 校验和：$(cat "$ARCHIVE.sha256")
[backup] 归档内容（三者缺一不可）：
$(tar -tzf "$ARCHIVE" | sed 's/^/         /')

恢复（演练过再上生产）：
  1) 停应用：docker compose stop app
  2) 恢复库：gunzip -c $ARCHIVE | tar -xO ./db.sql | psql "\$DATABASE_URL"
  3) 恢复附件与密钥：解包后把 attachments/ 与 master.key 放回 \$DATA_DIR（master.key 权限 600）
  4) 起应用：docker compose up -d app && curl -fsS http://localhost:3000/api/v1/system/status
EOF
