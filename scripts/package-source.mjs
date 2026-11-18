/** Export the public source tree, excluding internal process material and credentials. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
const output = resolve(process.argv[2] ?? '.cache/source-package/feronavi-source.tar.gz');
// Keep this explicit: newly added plans, reviews and agent files are private by default.
const publicFiles = new Set([
  'README.md', 'README.en.md', 'LICENSE', 'NOTICE', 'SECURITY.md',
  'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'index.html',
  'Dockerfile', 'compose.yaml', 'compose.ci.yaml', 'compose.dev.yaml', 'compose.source.yaml',
  'tsconfig.json', 'tsconfig.server.json', 'vite.config.ts', 'vitest.config.ts',
  'vitest.integration.config.ts', 'playwright.config.ts', 'drizzle.config.ts', 'eslint.config.js',
  '.env.example', '.gitignore', '.dockerignore', '.prettierignore', '.prettierrc',
  '.github/workflows/ci.yml', '.github/ISSUE_TEMPLATE/config.yml',
  '.github/ISSUE_TEMPLATE/bug_report.yml', '.github/ISSUE_TEMPLATE/feature_request.yml',
  '.devcontainer/devcontainer.json', '.devcontainer/compose.yaml',
  ...Array.from({ length: 12 }, (_, index) => `docs/screenshots/${String(index + 1).padStart(2, '0')}-${[
    'workbench-dark', 'project-overview', 'board', 'wiki-dark', 'insights', 'login', 'settings', 'timeline', 'projects', 'workbench-light', 'wiki-light', 'assistant',
  ][index]}.png`),
]);
const sourceDirectory = /^(src|tests|scripts|drizzle|docker|public|packages)\//;
const excluded = /(?:^|\/)(?:\.cache|\.git|node_modules|dist(?:-server)?|data|logs|\.claude|\.codex|\.agents)(?:\/|$)|(?:^|\/)\.env(?:\.|$)|(?:^|\/)(?:AGENTS|AGENT_RULES|CLAUDE|CONTRIBUTING|CLA)\.md$/;
const credentialPath = /(?:^|\/)secrets(?:\/|$)|\.(?:pem|key)$/i;
const names = [...new Set(execFileSync('git', ['ls-files', '-c', '-o', '--exclude-standard', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean))]
  .filter(name => publicFiles.has(name) || sourceDirectory.test(name))
  .filter(name => !excluded.test(name) || name === '.env.example')
  .filter(name => !credentialPath.test(name))
  .sort();
const manifest = [];
for (const name of names) {
  const stat = lstatSync(name);
  if (!stat.isFile()) throw new Error(`Source export requires ordinary files: ${name}`);
  const data = readFileSync(name);
  if (data.length < 2_000_000 && !data.includes(0)) {
    const text = data.toString('utf8');
    if (/(?:sk-|ak-)[a-zA-Z0-9]{30,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)) throw new Error(`Potential credential in source: ${name}`);
  }
  manifest.push({ path: name, bytes: stat.size, sha256: createHash('sha256').update(data).digest('hex') });
}
mkdirSync(dirname(output), { recursive: true });
const list = output + '.files';
writeFileSync(list, names.join('\0') + '\0');
execFileSync('tar', ['-czf', output, '--null', '-T', list], { env: { ...process.env, LC_ALL: 'C', COPYFILE_DISABLE: '1' } });
const archive = readFileSync(output);
const result = { archive: output.split('/').at(-1), bytes: archive.length, sha256: createHash('sha256').update(archive).digest('hex'), files: manifest };
writeFileSync(output + '.manifest.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ archive: output, files: names.length, bytes: archive.length, sha256: result.sha256 }));
