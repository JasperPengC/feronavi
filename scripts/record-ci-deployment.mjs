/** CI 中真实运行容器的回执；可信门禁仍由 GitHub API 回读 workflow/deployment。 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

assert.equal(process.env.GITHUB_ACTIONS, 'true', '仅在 GitHub Actions 候选部署步骤运行');
const sha = process.env.GITHUB_SHA;
assert.match(sha ?? '', /^[a-f0-9]{40}$/u);
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
const docker = args => execFileSync('docker', args, { encoding: 'utf8' }).trim();
const containers = {};
for (const service of ['app', 'worker']) {
  const id = docker(['compose', '-p', 'feronavi-ci', '-f', 'compose.yaml', '-f', 'compose.ci.yaml', 'ps', '-q', service]);
  assert.match(id, /^[a-f0-9]{12,64}$/u);
  const [container] = JSON.parse(docker(['inspect', id]));
  assert.equal(container.State.Running, true, service);
  assert.equal(container.State.Health?.Status, 'healthy', service);
  const [image] = JSON.parse(docker(['image', 'inspect', container.Image]));
  assert.equal(image.Config.Labels?.['org.opencontainers.image.revision'], sha, `${service} 提交不一致`);
  assert.equal(image.Config.Labels?.['org.opencontainers.image.version'], version);
  containers[service] = { id, image: image.Id, health: container.State.Health.Status };
}
const response = await fetch('http://127.0.0.1:33000/health', { signal: AbortSignal.timeout(10000) });
assert.equal(response.ok, true);
const health = await response.json();
assert.equal(health.ok, true);
assert.equal(health.database, 'ok');
mkdirSync('.cache/candidate-deployment', { recursive: true });
writeFileSync('.cache/candidate-deployment/receipt.json', JSON.stringify({
  environment: 'ci-candidate', lifetime: 'ephemeral-until-job-cleanup', commitSha: sha, version,
  run: `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`,
  attempt: Number(process.env.GITHUB_RUN_ATTEMPT), containers, health, verifiedAt: new Date().toISOString(),
}, null, 2) + '\n');
console.log('同 SHA 的 app / worker 健康；已保存一次性候选部署回执。');
