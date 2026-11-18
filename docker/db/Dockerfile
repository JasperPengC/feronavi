# ─────────────────────────────────────────────────────────────
# Feronavi · 数据库镜像：PostgreSQL 16 + pgvector + zhparser
#
# 为什么自建：
#   官方 postgres:16 镜像不含 pgvector；上游 zhparser 预编译镜像只有 amd64。
#   本项目要求 amd64 + arm64 双架构（Apple Silicon / ARM NAS），因此两个扩展
#   都从源码编译，不依赖任何预编译产物。
#
# 两阶段构建：
#   编译需要 build-essential + postgresql-server-dev（约 917MB），运行时完全用不到。
#   多阶段把它们留在 builder 层，最终镜像只含运行所需文件（实测 1341MB → 423MB）。
#
# ⚠️ 依赖关系（实测得出，删任何一项都会坏）：
#   zhparser 依赖 SCWS（简易中文分词库）。Debian 仓库没有该包，必须源码编译。
#   缺少 SCWS 时 zhparser 以 `fatal error: scws.h: No such file or directory` 失败，
#   且发生在**构建期** —— 每个自建镜像的人都会遇到。
#   SCWS 的**词典与规则文件**是运行期必需品，遗漏不会导致构建失败，只会让分词
#   静默失效（`NOTICE: zhparser set dict ... failed!`，检索结果恒为空）。
#   因此运行层必须带上：libscws.so.1 · dict.utf8.xdb · rules.utf8.ini · /usr/local/etc/rules*.ini
#
# 网络加固：
#   Debian 与 PGDG 官方源在部分地区不稳定（实测约 1/3 的包请求会 502）。
#   所有 apt 与 curl 请求都带重试，并提供 APT_MIRROR 构建参数以改用镜像站。
#
# 许可：pgvector / zhparser = PostgreSQL License；SCWS = BSD 系（见 NOTICE）
# ─────────────────────────────────────────────────────────────
# syntax=docker/dockerfile:1

ARG PG_MAJOR=16

# ════════════════════════════════════════════════════════════
# ① 构建阶段：编译扩展（构建工具只存在于这一层）
# ════════════════════════════════════════════════════════════
FROM postgres:${PG_MAJOR}-bookworm AS builder

ARG PG_MAJOR=16
ARG PGVECTOR_VER=0.8.7
# ⚠️ zhparser 的 tag 带前导 v，但 GitHub 归档解包后会**剥掉 v**：
#    tag `v2.3` → 目录 `zhparser-2.3`
ARG ZHPARSER_VER=v2.3
ARG SCWS_VER=1.2.3
# 可选：改用 Debian 镜像站（如 mirrors.aliyun.com / mirrors.tuna.tsinghua.edu.cn）
ARG APT_MIRROR=

RUN set -eux; \
    if [ -n "${APT_MIRROR}" ]; then \
        sed -i "s|deb.debian.org|${APT_MIRROR}|g" /etc/apt/sources.list.d/debian.sources; \
    fi; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        -o Acquire::Retries=5 \
        -o Acquire::http::Timeout=30 \
        build-essential \
        postgresql-server-dev-${PG_MAJOR} \
        ca-certificates \
        curl \
        bzip2; \
    rm -rf /var/lib/apt/lists/*

# pgvector（编译快，失败早暴露）
RUN set -eux; \
    curl -fsSL --retry 5 --retry-delay 2 \
        "https://github.com/pgvector/pgvector/archive/refs/tags/v${PGVECTOR_VER}.tar.gz" | tar xz; \
    cd "pgvector-${PGVECTOR_VER}"; \
    make -j"$(nproc)"; \
    make install; \
    cd /; \
    rm -rf "pgvector-${PGVECTOR_VER}"

# SCWS —— zhparser 的前置依赖
# 用官方发布包（自带生成的 configure）；GitHub 的 tag 归档只有 configure.ac，
# 需要 autoreconf 才能生成 configure，因此不作为主路径。
RUN set -eux; \
    curl -fsSL --retry 5 --retry-delay 2 \
        "http://www.xunsearch.com/scws/down/scws-${SCWS_VER}.tar.bz2" -o /tmp/scws.tar.bz2; \
    tar xjf /tmp/scws.tar.bz2 -C /tmp; \
    cd "/tmp/scws-${SCWS_VER}"; \
    ./configure --prefix=/usr/local; \
    make -j"$(nproc)"; \
    make install; \
    rm -rf /tmp/scws.tar.bz2 "/tmp/scws-${SCWS_VER}"

# zhparser（中文分词）
RUN set -eux; \
    curl -fsSL --retry 5 --retry-delay 2 \
        "https://github.com/amutu/zhparser/archive/refs/tags/${ZHPARSER_VER}.tar.gz" | tar xz; \
    cd "zhparser-${ZHPARSER_VER#v}"; \
    make -j"$(nproc)"; \
    make install; \
    cd /; \
    rm -rf "zhparser-${ZHPARSER_VER#v}"

# ════════════════════════════════════════════════════════════
# ② 运行阶段：只装运行所需（构建工具不进最终镜像）
# ════════════════════════════════════════════════════════════
FROM postgres:${PG_MAJOR}-bookworm

ARG PG_MAJOR=16

# 扩展的动态库
COPY --from=builder /usr/lib/postgresql/${PG_MAJOR}/lib/vector.so   /usr/lib/postgresql/${PG_MAJOR}/lib/
COPY --from=builder /usr/lib/postgresql/${PG_MAJOR}/lib/zhparser.so /usr/lib/postgresql/${PG_MAJOR}/lib/

# JIT 内联用的 LLVM bitcode（PostgreSQL 默认开启 JIT，缺它则扩展函数不被内联）
COPY --from=builder /usr/lib/postgresql/${PG_MAJOR}/lib/bitcode/vector/   /usr/lib/postgresql/${PG_MAJOR}/lib/bitcode/vector/
COPY --from=builder /usr/lib/postgresql/${PG_MAJOR}/lib/bitcode/zhparser/ /usr/lib/postgresql/${PG_MAJOR}/lib/bitcode/zhparser/
COPY --from=builder /usr/lib/postgresql/${PG_MAJOR}/lib/bitcode/vector.index.bc   /usr/lib/postgresql/${PG_MAJOR}/lib/bitcode/
COPY --from=builder /usr/lib/postgresql/${PG_MAJOR}/lib/bitcode/zhparser.index.bc /usr/lib/postgresql/${PG_MAJOR}/lib/bitcode/

# 扩展的 SQL 与 control 文件（CREATE EXTENSION 靠它们）
COPY --from=builder /usr/share/postgresql/${PG_MAJOR}/extension/vector.control   /usr/share/postgresql/${PG_MAJOR}/extension/
COPY --from=builder /usr/share/postgresql/${PG_MAJOR}/extension/vector--*.sql    /usr/share/postgresql/${PG_MAJOR}/extension/
COPY --from=builder /usr/share/postgresql/${PG_MAJOR}/extension/zhparser.control /usr/share/postgresql/${PG_MAJOR}/extension/
COPY --from=builder /usr/share/postgresql/${PG_MAJOR}/extension/zhparser--*.sql  /usr/share/postgresql/${PG_MAJOR}/extension/

# SCWS 运行库（zhparser.so 通过 DT_NEEDED 链接 libscws.so.1）
COPY --from=builder /usr/local/lib/libscws.so* /usr/local/lib/

# ⚠️ SCWS 词典与分词规则 —— 少了它们分词会静默失效（检索恒空）
COPY --from=builder /usr/share/postgresql/${PG_MAJOR}/tsearch_data/dict.utf8.xdb   /usr/share/postgresql/${PG_MAJOR}/tsearch_data/
COPY --from=builder /usr/share/postgresql/${PG_MAJOR}/tsearch_data/rules.utf8.ini /usr/share/postgresql/${PG_MAJOR}/tsearch_data/
COPY --from=builder /usr/local/etc/ /usr/local/etc/

# SCWS 命令行工具：管理员可用 scws-gen-dict 把项目专有名词（如「工作项」）加入自定义词典
COPY --from=builder /usr/local/bin/scws          /usr/local/bin/
COPY --from=builder /usr/local/bin/scws-gen-dict /usr/local/bin/
RUN ldconfig

# ── 许可与归属声明 ───────────────────────────────────────────
# 镜像也是分发物:pgvector / zhparser 用 PostgreSQL License、SCWS 用 BSD,
# 三者都要求随分发保留版权声明。这里只列【本镜像实际分发的组件】,
# 不是把仓库根目录 NOTICE 整个塞进来(那里面还有与数据库无关的 JS 依赖等)。
COPY --chown=0:0 LICENSE          /usr/share/doc/feronavi/LICENSE
COPY --chown=0:0 docker/db/NOTICE /usr/share/doc/feronavi/NOTICE

# ── 构建期自检 ───────────────────────────────────────────────
# 把「静默失效」变成「构建失败」：缺词典时镜像能起来但检索永远是空的，
# 这类问题在上线后才被发现代价极高。宁可在这里 fail。
RUN set -eux; \
    test -f /usr/lib/postgresql/${PG_MAJOR}/lib/vector.so; \
    test -f /usr/lib/postgresql/${PG_MAJOR}/lib/zhparser.so; \
    test -f /usr/local/lib/libscws.so.1; \
    test -f /usr/share/postgresql/${PG_MAJOR}/tsearch_data/dict.utf8.xdb; \
    test -f /usr/share/postgresql/${PG_MAJOR}/tsearch_data/rules.utf8.ini; \
    test -f /usr/local/etc/rules.utf8.ini; \
    test -x /usr/local/bin/scws-gen-dict; \
    test -s /usr/share/doc/feronavi/LICENSE; \
    test -s /usr/share/doc/feronavi/NOTICE; \
    grep -q "SCWS" /usr/share/doc/feronavi/NOTICE; \
    echo "自检通过：扩展动态库、SCWS 运行库、词典与规则、许可声明均已就位"

# ⚠️ initdb 的 locale 只在数据卷为空时生效；已有实例升级时不受影响
ENV POSTGRES_INITDB_ARGS="--encoding=UTF8 --locale=C.UTF-8"

# 首次初始化时自动建扩展（数据卷为空才执行）
COPY docker/db/initdb.d/ /docker-entrypoint-initdb.d/
RUN chmod 0644 /docker-entrypoint-initdb.d/*.sql