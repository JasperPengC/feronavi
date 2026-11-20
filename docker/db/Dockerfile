# syntax=docker/dockerfile:1
# PostgreSQL 16 + pgvector/zhparser; security-patched XML ABI shared with LLVM.
ARG PG_MAJOR=16
ARG ALPINE_VERSION=3.24

FROM postgres:${PG_MAJOR}-alpine${ALPINE_VERSION} AS xml-toolchain
RUN apk upgrade --no-cache && apk add --no-cache alpine-sdk openssl python3-dev zlib-dev xz-dev perl tar
RUN apk add --no-cache curl
FROM xml-toolchain AS xml-compiled
COPY docker/db/libxml2/APKBUILD /work/libxml2/APKBUILD
COPY docker/db/libxml2/patches/*.patch /work/libxml2/
RUN set -eux; \
    mkdir -p /root/.abuild /out/keys /out/apks; \
    openssl genrsa -out /root/.abuild/feronavi.rsa 4096; \
    openssl rsa -pubout -in /root/.abuild/feronavi.rsa -out /out/keys/feronavi.rsa.pub; \
    cp /out/keys/feronavi.rsa.pub /root/.abuild/feronavi.rsa.pub; \
    printf 'PACKAGER_PRIVKEY="/root/.abuild/feronavi.rsa"\nPACKAGER="Feronavi security backports"\n' > /root/.abuild/abuild.conf; \
    cd /work/libxml2; \
    mkdir -p /work/sources; \
    curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 https://download.gnome.org/sources/libxml2/2.13/libxml2-2.13.9.tar.xz -o /work/sources/libxml2-2.13.9.tar.xz; \
    SRCDEST=/work/sources REPODEST=/out/repository abuild -F validate fetch unpack prepare build
FROM xml-compiled AS xml-builder
COPY docker/db/libxml2/tests/ /work/libxml2/tests/
RUN set -eux; \
    cd /work/libxml2; \
    SRCDEST=/work/sources REPODEST=/out/repository abuild -F check rootpkg; \
    find /out/repository -type f -name '*.apk' -exec cp '{}' /out/apks/ ';'; \
    test -s /out/apks/libxml2-2.13.9-r3.apk; \
    cp /out/keys/*.pub /etc/apk/keys/; \
    apk verify /out/apks/libxml2-2.13.9-r3.apk; \
    apk add --no-cache /out/apks/libxml2-2.13.9-r3.apk; \
    sha256sum /usr/lib/libxml2.so.2 > /out/libxml2-from-apk.sha256; \
    cp src/libxml2-2.13.9/Copyright /out/libxml2-Copyright

FROM postgres:${PG_MAJOR}-alpine${ALPINE_VERSION} AS extension-toolchain
RUN apk upgrade --no-cache && apk add --no-cache build-base curl ca-certificates bzip2 clang21 llvm21-dev
FROM extension-toolchain AS builder
COPY --from=xml-builder /out/keys/ /etc/apk/keys/
COPY --from=xml-builder /out/apks/ /tmp/xml-apks/
RUN set -eux; \
    apk add --no-cache /tmp/xml-apks/libxml2-2.13.9-r3.apk /tmp/xml-apks/libxml2-utils-2.13.9-r3.apk /tmp/xml-apks/libxml2-dev-2.13.9-r3.apk; \
    rm -rf /tmp/xml-apks
ARG PGVECTOR_VER=0.8.7
ARG PGVECTOR_SHA256=cac0b10c360f05b2d521200105ba3697e773d4cd3731f5a915a7e37ebe0bea85
RUN set -eux; \
    curl -fsSL --retry 5 --retry-delay 2 "https://github.com/pgvector/pgvector/archive/refs/tags/v${PGVECTOR_VER}.tar.gz" -o /tmp/vector.tar.gz; \
    echo "${PGVECTOR_SHA256}  /tmp/vector.tar.gz" | sha256sum -c -; \
    tar xzf /tmp/vector.tar.gz -C /tmp; \
    cd "/tmp/pgvector-${PGVECTOR_VER}"; make -j4 OPTFLAGS=""; make install
ARG SCWS_VER=1.2.3
ARG SCWS_SHA256=60d50ac3dc42cff3c0b16cb1cfee47d8cb8c8baa142a58bc62854477b81f1af5
RUN set -eux; \
    curl -fsSL --retry 5 --retry-delay 2 "https://www.xunsearch.com/scws/down/scws-${SCWS_VER}.tar.bz2" -o /tmp/scws.tar.bz2; \
    echo "${SCWS_SHA256}  /tmp/scws.tar.bz2" | sha256sum -c -; \
    tar xjf /tmp/scws.tar.bz2 -C /tmp; \
    cd "/tmp/scws-${SCWS_VER}"; ./configure --prefix=/usr/local --disable-static; make -j4; make install
ARG ZHPARSER_VER=v2.3
ARG ZHPARSER_SHA256=96fe19f1b72c922eab19ecfc305384381562ff840da4d3b77452e21fefe8f0d2
RUN set -eux; \
    curl -fsSL --retry 5 --retry-delay 2 "https://github.com/amutu/zhparser/archive/refs/tags/${ZHPARSER_VER}.tar.gz" -o /tmp/zhparser.tar.gz; \
    echo "${ZHPARSER_SHA256}  /tmp/zhparser.tar.gz" | sha256sum -c -; \
    tar xzf /tmp/zhparser.tar.gz -C /tmp; \
    cd "/tmp/zhparser-${ZHPARSER_VER#v}"; make -j4; make install

FROM postgres:${PG_MAJOR}-alpine${ALPINE_VERSION} AS runtime
COPY --from=xml-builder /out/keys/ /etc/apk/keys/
COPY --from=xml-builder /out/apks/libxml2-2.13.9-r3.apk /tmp/libxml2-fixed.apk
RUN set -eux; apk upgrade --no-cache; apk add --no-cache 'libcrypto3>=3.5.9-r1' 'libssl3>=3.5.9-r1' /tmp/libxml2-fixed.apk; rm /tmp/libxml2-fixed.apk
COPY --from=builder /usr/local/lib/postgresql/vector.so /usr/local/lib/postgresql/zhparser.so /usr/local/lib/postgresql/
COPY --from=builder /usr/local/lib/postgresql/bitcode/vector/ /usr/local/lib/postgresql/bitcode/vector/
COPY --from=builder /usr/local/lib/postgresql/bitcode/zhparser/ /usr/local/lib/postgresql/bitcode/zhparser/
COPY --from=builder /usr/local/lib/postgresql/bitcode/vector.index.bc /usr/local/lib/postgresql/bitcode/zhparser.index.bc /usr/local/lib/postgresql/bitcode/
COPY --from=builder /usr/local/share/postgresql/extension/vector* /usr/local/share/postgresql/extension/
COPY --from=builder /usr/local/share/postgresql/extension/zhparser* /usr/local/share/postgresql/extension/
COPY --from=builder /usr/local/lib/libscws.so* /usr/local/lib/
COPY --from=builder /usr/local/share/postgresql/tsearch_data/dict.utf8.xdb /usr/local/share/postgresql/tsearch_data/rules.utf8.ini /usr/local/share/postgresql/tsearch_data/
COPY --from=builder /usr/local/etc/ /usr/local/etc/
COPY --from=builder /usr/local/bin/scws /usr/local/bin/scws-gen-dict /usr/local/bin/
COPY LICENSE /usr/share/doc/feronavi/LICENSE
COPY docker/db/NOTICE.alpine /usr/share/doc/feronavi/NOTICE
COPY docker/db/licenses/ /usr/share/doc/feronavi/licenses/
COPY --from=xml-builder /out/libxml2-Copyright /usr/share/doc/feronavi/licenses/libxml2-Copyright
COPY docker/db/libxml2/security-backports.json /usr/share/doc/feronavi/security/libxml2-backports.json
COPY docker/db/libxml2/patches/ /usr/share/doc/feronavi/security/libxml2-patches/
COPY docker/db/libxml2/APKBUILD /usr/share/doc/feronavi/security/libxml2-APKBUILD
COPY --from=xml-builder /out/libxml2-from-apk.sha256 /usr/share/doc/feronavi/security/libxml2-from-apk.sha256
COPY docker/db/initdb.d/ /docker-entrypoint-initdb.d/
RUN set -eux; \
    test -s /usr/local/lib/postgresql/vector.so; test -s /usr/local/lib/postgresql/zhparser.so; \
    test -s /usr/local/share/postgresql/tsearch_data/dict.utf8.xdb; test -s /usr/local/etc/rules.utf8.ini; \
    test -s /usr/share/doc/feronavi/licenses/pgvector-LICENSE; test -s /usr/share/doc/feronavi/licenses/zhparser-COPYRIGHT; \
    test -s /usr/share/doc/feronavi/licenses/scws-COPYING; test -s /usr/share/doc/feronavi/licenses/libxml2-Copyright; \
    apk info -e 'libxml2=2.13.9-r3'; \
    apk info -W /usr/lib/libxml2.so.2; \
    expected_xml_sha="$(cut -d ' ' -f1 /usr/share/doc/feronavi/security/libxml2-from-apk.sha256)"; \
    echo "$expected_xml_sha  /usr/lib/libxml2.so.2" | sha256sum -c -; \
    sha256sum /usr/lib/libxml2.so.2 > /usr/share/doc/feronavi/security/libxml2-binary.sha256; \
    scanelf -n /usr/local/bin/postgres /usr/local/lib/postgresql/vector.so /usr/local/lib/postgresql/zhparser.so /usr/lib/libLLVM.so.21.1 /usr/lib/libxslt.so.1; \
    chmod 0644 /docker-entrypoint-initdb.d/*.sql
ENV POSTGRES_INITDB_ARGS="--encoding=UTF8 --locale=C.UTF-8"
