/** Export the current reviewed source tree, excluding local data, evidence media and credentials. */
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
const sourceDirectory = /^(src|tests|scripts|drizzle|docker|public|packages|patches)\//;
const excluded = /(?:^|\/)(?:\.cache|\.git|node_modules|dist(?:-server)?|data|logs|\.claude|\.codex|\.agents)(?:\/|$)|(?:^|\/)\.env(?:\.|$)|(?:^|\/)(?:AGENTS|AGENT_RULES|CLAUDE|CONTRIBUTING|CLA)\.md$/;
const credentialPath = /(?:^|\/)secrets(?:\/|$)|\.(?:pem|key)$/i;
const names = [...new Set(execFileSync('git', ['ls-files', '-c', '-o', '--exclude-standard', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean))]
  .filter(name => publicFiles.has(name) || sourceDirectory.test(name))
  .filter(name => !excluded.test(name) || name === '.env.example')
  .filter(name => !credentialPath.test(name))
  .sort();
// 公开快照也必须包含完整产品入口，避免只导出了旧提交而遗失工作树中的既有功能。
if (names.includes('src/server/app.ts')) {
  const requiredProductFiles = [
    'src/client/routes/AssistantPage.tsx', 'src/client/components/assistant/ConversationList.tsx',
    'src/client/components/ui/MermaidDiagram.tsx', 'src/server/routes/rag.ts',
    'src/server/routes/rag-conversations.ts', 'src/server/services/rag-conversation.service.ts',
    'src/server/application/capabilities/tools.ts', 'src/server/services/assistant-tools.ts',
    'src/server/services/collab-document.service.ts', 'src/server/services/system-backup/registry.ts',
    'src/server/routes/system-backups.ts', 'drizzle/meta/_journal.json',
    'docker/db/Dockerfile', 'docker/db/NOTICE.alpine', 'docker/db/libxml2/APKBUILD',
    'docker/db/libxml2/security-backports.json', 'patches/postgres@3.4.9.patch',
    'public/THIRD_PARTY_NOTICES.txt', 'public/licenses/shadcn-ui-LICENSE.txt',
    'src/db/migrate-cli.ts', 'scripts/build-tools/mermaid-parser-grammars.ts',
  ];
  const missing = requiredProductFiles.filter(name => !names.includes(name));
  if (missing.length) throw new Error(`Incomplete product source: ${missing.join(', ')}`);
}
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
