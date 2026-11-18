-- ─────────────────────────────────────────────────────────────
-- 首次初始化数据库时自动执行（仅当数据卷为空）
--
-- 目的：让 zhparser 与 vector 两个扩展在 `docker compose up -d db`
--       之后即可用（可用 \dx 确认）。
--
-- ⚠️ 本脚本只在**全新数据卷**上运行一次。已有实例请由迁移脚本负责建扩展。
-- ─────────────────────────────────────────────────────────────

-- 向量检索（语义搜索）
CREATE EXTENSION IF NOT EXISTS vector;

-- 中文分词（全文检索）
CREATE EXTENSION IF NOT EXISTS zhparser;

-- 中文全文检索配置：用 zhparser 作为分词器
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_ts_config WHERE cfgname = 'chinese_zh') THEN
        CREATE TEXT SEARCH CONFIGURATION chinese_zh (PARSER = zhparser);
        ALTER TEXT SEARCH CONFIGURATION chinese_zh
            ADD MAPPING FOR n,v,a,i,e,l,j WITH simple;
    END IF;
END
$$;

-- 模糊匹配兜底（若 zhparser 在某些架构上不可用，可用 pg_trgm 降级）
-- Debian/PGDG 的 postgresql-16 主包内已含 pg_trgm，无需额外安装
CREATE EXTENSION IF NOT EXISTS pg_trgm;
