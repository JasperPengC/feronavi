/** 检查完整Trivy OS报告；所有HIGH/CRITICAL均阻断，不豁免尚无修复的漏洞。 */
import { readFile } from "node:fs/promises";

const severities = ["UNKNOWN", "LOW", "MEDIUM", "HIGH", "CRITICAL"];
const nonempty = value => typeof value === "string" && value.trim().length > 0;
function validate(condition, message) { if (!condition) throw new Error(message); }
function summarize(report, path) {
  validate(report?.SchemaVersion === 2 && report.ArtifactType === "container_image" && nonempty(report.ArtifactName), "不是受支持的Trivy容器报告");
  validate(nonempty(report.Metadata?.OS?.Family) && nonempty(report.Metadata.OS.Name), "报告缺少已识别的OS元数据");
  validate(Array.isArray(report.Results) && report.Results.length > 0, "报告缺少OS扫描结果");
  const bySeverity = Object.fromEntries(severities.map(severity => [severity, 0]));
  const blockingVulnerabilities = [];
  let total = 0, unfixed = 0, unfixedHighCritical = 0;
  for (const result of report.Results) {
    validate(result?.Class === "os-pkgs" && nonempty(result.Target) && nonempty(result.Type), "报告包含无效或非OS扫描结果");
    validate(result.Vulnerabilities === undefined || Array.isArray(result.Vulnerabilities), "漏洞列表格式无效");
    for (const entry of result.Vulnerabilities ?? []) {
      validate(nonempty(entry?.VulnerabilityID) && nonempty(entry.PkgName) && nonempty(entry.InstalledVersion), "漏洞缺少ID、包名或安装版本");
      validate(severities.includes(entry.Severity), "漏洞严重度无效");
      validate(entry.FixedVersion === undefined || typeof entry.FixedVersion === "string", "漏洞修复版本格式无效");
      const fixed = nonempty(entry.FixedVersion);
      const high = entry.Severity === "HIGH" || entry.Severity === "CRITICAL";
      total++;
      bySeverity[entry.Severity]++;
      if (!fixed) { unfixed++; if (high) unfixedHighCritical++; }
      if (high) blockingVulnerabilities.push({
        id: entry.VulnerabilityID, package: entry.PkgName, installedVersion: entry.InstalledVersion,
        fixedVersion: entry.FixedVersion ?? null, severity: entry.Severity,
      });
    }
  }
  return { path, image: report.ArtifactName, os: report.Metadata.OS, total, bySeverity, unfixed, unfixedHighCritical,
    blocking: blockingVulnerabilities.length, blockingVulnerabilities };
}

const paths = process.argv.slice(2);
const reports = [], errors = [];
if (!paths.length) errors.push({ message: "必须提供至少一份完整Trivy OS JSON报告" });
for (const path of paths) {
  try { reports.push(summarize(JSON.parse(await readFile(path, "utf8")), path)); }
  catch (error) { errors.push({ path, message: error.message }); }
}
const sum = key => reports.reduce((total, report) => total + report[key], 0);
const blocking = sum("blocking");
const conclusion = errors.length ? "阻断：扫描报告缺失或格式无效。"
  : blocking ? "阻断：存在HIGH/CRITICAL（包括尚无修复版本的漏洞）。"
    : "允许：未发现HIGH/CRITICAL；报告仍可能包含其他级别漏洞。";
console.log(JSON.stringify({ policy: "all-high-critical", total: sum("total"), blocking, unfixed: sum("unfixed"),
  unfixedHighCritical: sum("unfixedHighCritical"), reports, errors, conclusion }, null, 2));
process.exitCode = errors.length ? 2 : blocking ? 1 : 0;
