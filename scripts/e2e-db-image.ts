/** 对指定测试镜像启动的独立容器验收；数据库必须来自隔离 runner。 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import postgres from "postgres";
import { assertIsolatedTestEnvironment } from "./test-environment.mjs";

assertIsolatedTestEnvironment();
const container = process.env.PG_CONTAINER;
assert.ok(container && /^feronavi-db-accept-[a-f0-9-]+$/u.test(container), "只允许本轮独立镜像验收容器");
const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
try {
  const [version] = await sql`show server_version`;
  assert.match(version!.server_version, /^16\./u);
  const release = execFileSync("docker", ["exec", container!, "cat", "/etc/os-release"], { encoding: "utf8" });
  const alpine = /^ID=alpine$/mu.test(release);
  const extensions = await sql`select extname,extversion from pg_extension where extname in ('vector','zhparser') order by extname`;
  assert.deepEqual(extensions.map(row => row.extname), ["vector", "zhparser"]);
  const [segmented] = await sql`select to_tsvector('chinese_zh', '中华人民共和国数据库安全恢复验证')::text as result`;
  assert.match(segmented!.result, /数据库|安全|恢复/u);
  const [search] = await sql`select to_tsvector('chinese_zh','数据库安全恢复验证') @@ plainto_tsquery('chinese_zh','数据库') as found`;
  assert.equal(search!.found, true);
  const [distance] = await sql`select '[1,2,3]'::vector <-> '[1,2,4]'::vector as distance`;
  assert.equal(distance!.distance, 1);
  await sql`create table db_image_vector_probe (id integer primary key, embedding vector(3))`;
  await sql`insert into db_image_vector_probe values (1,'[1,2,3]'),(2,'[1,2,4]')`;
  await sql`create index db_image_vector_probe_hnsw on db_image_vector_probe using hnsw (embedding vector_l2_ops)`;
  assert.equal((await sql`select id from db_image_vector_probe order by embedding <-> '[1,2,3]'::vector limit 1`)[0]!.id, 1);
  assert.equal((await sql`show server_encoding`)[0]!.server_encoding, "UTF8");
  const [locale] = await sql`select datcollate,datctype from pg_database where datname=current_database()`;
  assert.equal(locale!.datcollate, alpine ? "C" : "C.UTF-8");
  assert.equal(locale!.datctype, "C.UTF-8");
  assert.equal((await sql`select pg_jit_available() as available`)[0]!.available, true);
  assert.equal((await sql`select (xpath('/root/item/text()',xmlparse(document '<root><item>恢复</item></root>')))::text[] as result`)[0]!.result[0], "恢复");
  await sql`create extension if not exists xml2`;
  const stylesheet = '<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform"><xsl:output method="text"/><xsl:template match="/"><xsl:value-of select="/root/item"/></xsl:template></xsl:stylesheet>';
  assert.equal((await sql`select xslt_process('<root><item>恢复</item></root>',${stylesheet}) as result`)[0]!.result, "恢复");
  await sql`set jit_above_cost=0`;
  await sql`set jit_inline_above_cost=0`;
  await sql`set jit_optimize_above_cost=0`;
  const [plan] = await sql`explain (analyze,format json) select sum(embedding <-> '[1,2,3]'::vector) from db_image_vector_probe`;
  assert.ok(plan!["QUERY PLAN"][0].JIT?.Functions > 0, "向量表达式实际执行LLVM JIT");
  const share = execFileSync("docker", ["exec", container!, "pg_config", "--sharedir"], { encoding: "utf8" }).trim();
  const files = [
    "/usr/share/doc/feronavi/LICENSE", "/usr/share/doc/feronavi/NOTICE",
    "/usr/share/doc/feronavi/licenses/pgvector-LICENSE",
    "/usr/share/doc/feronavi/licenses/zhparser-COPYRIGHT",
    "/usr/share/doc/feronavi/licenses/scws-COPYING",
    "/usr/local/lib/libscws.so.1", "/usr/local/etc/rules.utf8.ini",
    `${share}/tsearch_data/dict.utf8.xdb`,
    `${share}/tsearch_data/rules.utf8.ini`,
  ];
  for (const path of files) execFileSync("docker", ["exec", container!, "test", "-s", path], { stdio: "pipe" });
  const suite = alpine ? "alpine" : /^VERSION_CODENAME=(\w+)$/mu.exec(release)?.[1];
  if (process.env.DB_IMAGE_EXPECT_SUITE) assert.equal(suite, process.env.DB_IMAGE_EXPECT_SUITE);
  const installed = execFileSync("docker", ["exec", container!, ...(alpine ? ["apk", "info", "-v"] : ["dpkg-query", "-W", "-f=${Package}\t${Version}\n"])], { encoding: "utf8" });
  const packages = alpine ? installed : installed.split("\n").filter(line => /^(apt|libapt-pkg[0-9.]+|libssl3(?:t64)?|openssl|libsqlite3-0|libxml2|zlib1g)\t/u.test(line)).join("\n");
  const floors = alpine ? [] : suite === "trixie"
    ? [["apt", "3.0.4"], ["libapt-pkg7.0", "3.0.4"], ["libssl3t64", "3.5.7-1~deb13u3"], ["openssl", "3.5.7-1~deb13u3"], ["zlib1g", "1:1.3.dfsg+really1.3.1-1+deb13u1"]]
    : [["apt", "2.6.2"], ["libapt-pkg6.0", "2.6.2"], ["libssl3", "3.0.22-1~deb12u2"], ["openssl", "3.0.22-1~deb12u2"]];
  for (const [name, minimum] of floors) {
    const line = packages.split("\n").find(value => value.startsWith(`${name}\t`));
    assert.ok(line, `package ${name}`);
    execFileSync("docker", ["exec", container!, "dpkg", "--compare-versions", line!.split("\t")[1]!, "ge", minimum!], { stdio: "pipe" });
  }
  if (alpine) {
    execFileSync("docker", ["exec", container!, "apk", "info", "-e", "libxml2=2.13.9-r3"], { stdio: "pipe" });
    const securityRoot = "/usr/share/doc/feronavi/security";
    const manifest = JSON.parse(execFileSync("docker", ["exec", container!, "cat", `${securityRoot}/libxml2-backports.json`], { encoding: "utf8" }));
    assert.equal(manifest.upstreamVersion, "2.13.9");
    assert.equal(manifest.feronaviRevision, 3);
    assert.deepEqual(manifest.backports.map((row: { cve: string }) => row.cve).sort(), ["CVE-2026-74860", "CVE-2026-86138", "CVE-2026-86140", "CVE-2026-86142", "CVE-2026-86143", "CVE-2026-86144"]);
    for (const patch of [...manifest.backports, ...manifest.preservedAlpinePatches]) {
      assert.match(patch.patch, /^CVE-\d+-\d+[-a-z]*\.patch$/u);
      const content = execFileSync("docker", ["exec", container!, "cat", `${securityRoot}/libxml2-patches/${patch.patch}`]);
      assert.equal(createHash("sha512").update(content).digest("hex"), patch.sha512, `实际分发补丁 ${patch.patch}`);
    }
    const library = execFileSync("docker", ["exec", container!, "cat", "/usr/lib/libxml2.so.2"], { maxBuffer: 8 * 1024 * 1024 });
    const actualHash = createHash("sha256").update(library).digest("hex");
    const expectedHash = execFileSync("docker", ["exec", container!, "cat", `${securityRoot}/libxml2-binary.sha256`], { encoding: "utf8" }).split(/\s+/u)[0];
    assert.equal(actualHash, expectedHash);
    const packageHash = execFileSync("docker", ["exec", container!, "cat", `${securityRoot}/libxml2-from-apk.sha256`], { encoding: "utf8" }).split(/\s+/u)[0];
    assert.equal(actualHash, packageHash, "运行库与签名APK实际安装产物一致");
    const owner = execFileSync("docker", ["exec", container!, "apk", "info", "-W", "/usr/lib/libxml2.so.2"], { encoding: "utf8" });
    assert.match(owner, /libxml2-2\.13\.9-r3/u);
    const bindir = execFileSync("docker", ["exec", container!, "pg_config", "--bindir"], { encoding: "utf8" }).trim();
    for (const consumer of [`${bindir}/postgres`, "/usr/lib/libxslt.so.1", "/usr/lib/libLLVM.so.21.1"]) {
      const linkage = execFileSync("docker", ["exec", container!, "ldd", consumer], { encoding: "utf8" });
      assert.match(linkage, /libxml2\.so\.2 => \/usr\/lib\/libxml2\.so\.2/u, `实际消费者 ${consumer}`);
    }
    const names = new Set(execFileSync("docker", ["exec", container!, "apk", "info"], { encoding: "utf8" }).split("\n"));
    for (const absent of ["acl", "acl-libs", "sqlite", "sqlite-libs", "py3-libxml2"]) assert.ok(!names.has(absent), `运行层不分发 ${absent}`);
    console.log(`PASS signed libxml2 r3; 8 distributed patch SHA512; installed library SHA256=${actualHash}; PostgreSQL/libxslt/LLVM share patched ABI; XML/XSLT; no ACL/SQLite/Python binding runtime packages`);
  }
  if (process.env.DB_IMAGE_EXPECT_NO_GPG === "1") {
    const names = alpine ? new Set(execFileSync("docker", ["exec", container!, "apk", "info"], { encoding: "utf8" }).split("\n")) : new Set(installed.split("\n").map(line => line.split("\t")[0]));
    for (const name of ["gnupg", "gnupg-l10n", "dirmngr", "gpg", "gpg-agent", "gpgconf", "gpgsm"]) {
      assert.ok(!names.has(name), `移除构建期包 ${name}`);
    }
  }
  console.log(`PASS PostgreSQL ${version!.server_version}; ${extensions.map(row => `${row.extname} ${row.extversion}`).join(', ')}; UTF8 + collation=${locale!.datcollate}/ctype=${locale!.datctype}; Chinese segmentation/query; vector distance/HNSW/actual LLVM JIT; SCWS dictionaries and all license files`);
  console.log(`PASS ${suite} package floors and optional build-tool removal gate\n${packages.trim()}`);
} finally { await sql.end({ timeout: 1 }); }
