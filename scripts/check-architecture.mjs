/** Runtime dependency gate: static and literal dynamic imports, excluding type-only edges. */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
const root = process.cwd();
function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const name = path.join(dir, entry.name);
    return entry.isDirectory() ? files(name) : /\.(ts|tsx)$/.test(name) ? [name] : [];
  });
}
const sources = files(path.join(root, 'src'));
const keys = new Set(sources.map(file => path.relative(root, file).split(path.sep).join('/')));
const graph = new Map([...keys].map(key => [key, new Set()]));
for (const file of sources) {
  const key = path.relative(root, file).split(path.sep).join('/');
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  function edge(value) {
    if (!value?.startsWith('.')) return;
    const target = path.relative(root, path.resolve(path.dirname(file), value)).split(path.sep).join('/');
    if (keys.has(target)) graph.get(key).add(target);
  }
  function visit(node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const bindings = clause?.namedBindings;
      const onlyTypes = clause?.isTypeOnly || (clause && !clause.name && bindings && ts.isNamedImports(bindings) && bindings.elements.every(element => element.isTypeOnly));
      if (!onlyTypes) edge(node.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) && !node.isTypeOnly) {
      if (!node.exportClause || !ts.isNamedExports(node.exportClause) || node.exportClause.elements.some(element => !element.isTypeOnly)) edge(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && ts.isStringLiteral(node.arguments[0])) {
      edge(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}
let next = 0;
const indexes = new Map(), low = new Map(), stack = [], active = new Set(), cycles = [];
function connect(key) {
  indexes.set(key, next); low.set(key, next++); stack.push(key); active.add(key);
  for (const target of graph.get(key)) {
    if (!indexes.has(target)) { connect(target); low.set(key, Math.min(low.get(key), low.get(target))); }
    else if (active.has(target)) low.set(key, Math.min(low.get(key), indexes.get(target)));
  }
  if (low.get(key) === indexes.get(key)) {
    const component = []; let member;
    do { member = stack.pop(); active.delete(member); component.push(member); } while (member !== key);
    if (component.length > 1 || graph.get(key).has(key)) cycles.push(component.sort());
  }
}
for (const key of graph.keys()) if (!indexes.has(key)) connect(key);
const violations = [];
for (const [source, targets] of graph) for (const target of targets) {
  if (source.startsWith('src/server/services/') && /^src\/server\/(mcp|routes)\//.test(target)) violations.push({ source, target, reason: 'domain-to-protocol' });
  if (source.startsWith('src/db/') && target.startsWith('src/server/')) violations.push({ source, target, reason: 'database-to-server' });
  if (source.startsWith('src/server/application/capabilities/') && /^src\/server\/(mcp|routes)\//.test(target)) violations.push({ source, target, reason: 'capability-to-protocol' });
}
const result = { modules: graph.size, edges: [...graph.values()].reduce((sum, targets) => sum + targets.size, 0), cycles, violations };
const output = process.argv.indexOf('--json');
if (output >= 0 && process.argv[output + 1]) fs.writeFileSync(process.argv[output + 1], JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
if (cycles.length || violations.length) process.exitCode = 1;
