import type { MigrationMeta } from "drizzle-orm/migrator";

type AppliedMigration = { hash: string; created_at: string | number | null };
type HistoricalMigration = { hash: string; when: number; canonicalHash?: string };

// 仅接受曾交付过的旧完整产品迁移。SQL内容相同的迁移即使重编号也只执行一次。
// 旧计划迁移只调整了四条ADD COLUMN的顺序，保留其原账本并映射到等价版本。
const LEGACY_PRODUCT_MIGRATIONS: readonly HistoricalMigration[] = [
  { hash: "cb19bca5c04a6d302e31429592c38413d0e20c1263b4b9996d9b85b134b6a600", when: 1794590947741 },
  { hash: "f773dd3d7e24aca133262834944aca87701e31e6ca85051d36e00854f50946b1", when: 1794657600000 },
  { hash: "d0029dc22644737a1e87e0d1e4f67d806e0a37eb4f82696ce38d154cfbc12fc7", when: 1794661200000 },
  { hash: "c5cbff4e89529f41bfb93566a791da56bc14fe6934f0b53880398668a32007d0", when: 1794664800000 },
  { hash: "e3444dfb78f3d89ddb63581629fa9c3a61ebc52ffabd07ea536300b03a2660f3", when: 1794672000000 },
  { hash: "c0e34962b6f4ae29851af80810107b9fca4b6efd782528678cf89c9de68a734d", when: 1794765600000, canonicalHash: "abadb38e35b5846d0f9aba2aa6df65af8690a21070c6ca58fd06ac64987bbf8d" },
  { hash: "b7e3c84063f5755776dfd418e42925159015b156993bdfcaf3d07a1d711608b2", when: 1794769200000 },
  { hash: "4b5195370cb2f61a2949bdab786c400c3efed9502a86235e9b218d27ccee9236", when: 1794772800000 },
  { hash: "0a9e141d94ad1d625a72711be80748671488ad0b3f0cf9c7dcaf4f2ae7005604", when: 1794801600000 },
  { hash: "52d27d9b507e0909b7c1524be44bb8546e2f2cfb31a1b880acea777fe6d17231", when: 1794898800000 },
  { hash: "1076388c9e10e6e15e468d46ba59a1d41eaf869fb2c03b0c46cd29e5f33f01ad", when: 1794900000000 },
];
const SHARED_BASE_HASH = "48b679736530152a7c98b46db928334532555a6c0e0335ad130ef14e99a7b0ff";

/** 按内容和完整历史顺序识别待迁移项；拒绝未知、缺项或被修改的账本。 */
export function pendingMigrations(migrations: readonly MigrationMeta[], applied: readonly AppliedMigration[]): MigrationMeta[] {
  const canonical: HistoricalMigration[] = migrations.map(migration => ({ hash: migration.hash, when: migration.folderMillis }));
  if (new Set(canonical.map(entry => entry.hash)).size !== canonical.length) throw new Error("迁移历史包含重复SQL内容");
  if (canonical.some((entry, index) => index > 0 && entry.when <= canonical[index - 1]!.when)) throw new Error("迁移历史时间必须严格递增");
  const candidates: HistoricalMigration[][] = [canonical];
  const commonEnd = canonical.findIndex(entry => entry.hash === SHARED_BASE_HASH);
  if (commonEnd >= 0) {
    for (let count = 1; count <= LEGACY_PRODUCT_MIGRATIONS.length; count++) {
      const legacy = LEGACY_PRODUCT_MIGRATIONS.slice(0, count);
      // 截断迁移目录不能偷偷接受更高版本数据库，仍须完整包含每项等价SQL。
      if (!legacy.every(entry => canonical.some(item => item.hash === (entry.canonicalHash ?? entry.hash)))) break;
      const initial = [...canonical.slice(0, commonEnd + 1), ...legacy];
      const known = new Set(initial.map(entry => entry.canonicalHash ?? entry.hash));
      candidates.push([...initial, ...canonical.filter(entry => !known.has(entry.hash))]);
    }
  }
  const sequence = candidates.find(candidate => applied.length <= candidate.length && applied.every((entry, index) =>
    entry.hash === candidate[index]!.hash && Number(entry.created_at) === candidate[index]!.when,
  ));
  if (!sequence) throw new Error("迁移历史与受支持版本不一致；已停止升级，请核对迁移文件与数据库备份");
  const completed = new Set(sequence.slice(0, applied.length).map(entry => entry.canonicalHash ?? entry.hash));
  return migrations.filter(migration => !completed.has(migration.hash));
}
