/** 从领域服务实际返回类型生成传输契约；不导入/执行数据库或工具处理器。 */
import ts from 'typescript';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cf = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile);
const config = ts.parseJsonConfigFileContent(cf.config, ts.sys, root);
const program = ts.createProgram(config.fileNames, config.options);
const checker = program.getTypeChecker();
const definitions = {};
const results = {};
const sources = {};
const ids = new Map();
const json = { $ref: '#/$defs/JsonValue' };
definitions.JsonValue = { anyOf: [{ type: 'null' }, { type: 'boolean' }, { type: 'number' }, { type: 'string' }, { type: 'array', items: json }, { type: 'object', additionalProperties: json }] };
const object = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const ok = object({ ok: { type: 'boolean' } });
const nullable = (schema) => ({ anyOf: [schema, { type: 'null' }] });
const serializable = (t) => !(t.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Void | ts.TypeFlags.Never));
function schema(type, location, field = '') {
  const promised = checker.getPromisedTypeOfPromise(type);
  if (promised) return schema(promised, location, field);
  if (type.isUnion()) {
    if (type.types.every(t => t.flags & ts.TypeFlags.StringLiteral)) return {type:'string',enum:type.types.map(t => t.value)};
    if (type.types.every(t => t.flags & ts.TypeFlags.BooleanLiteral)) return {type:'boolean'};
    const variants = type.types.filter(serializable).map(t => schema(t, location, field));
    const distinct = [...new Map(variants.map(s => [JSON.stringify(s), s])).values()];
    return distinct.length === 1 ? distinct[0] : { anyOf: distinct.length ? distinct : [{ type: 'null' }] };
  }
  if (type.flags & ts.TypeFlags.StringLiteral) return { type: 'string', const: type.value };
  if (type.flags & ts.TypeFlags.NumberLiteral) return { type: 'number', const: type.value };
  if (type.flags & ts.TypeFlags.BooleanLiteral) return { type: 'boolean', const: type.intrinsicName === 'true' };
  if (type.flags & ts.TypeFlags.Null) return { type: 'null' };
  if (!serializable(type)) return { type: 'null' };
  if (type.flags & ts.TypeFlags.String) {
    if (/At$/.test(field)) return { type:'string', format:'date-time' };
    if (/^(?:startDate|endDate|dueDate|releaseDate|date|day)$/.test(field)) return { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
    return { type: 'string' };
  }
  if (type.flags & ts.TypeFlags.Number) return { type: /(?:Count|Minutes|Ms|Bytes|Order|RevisionNo|Version)$|^(?:total|page|pageSize|offset|limit|version|number|revisionNo)$/.test(field) ? 'integer' : 'number' };
  if (type.flags & ts.TypeFlags.Boolean) return { type: 'boolean' };
  if (type.getSymbol()?.getName() === 'Date') return { type: 'string', format: 'date-time' };
  if (checker.isTupleType(type)) return { type: 'array', items: { anyOf: checker.getTypeArguments(type).map(t => schema(t, location)) } };
  if (checker.isArrayType(type)) return { type: 'array', items: schema(checker.getTypeArguments(type)[0], location) };
  // JSONB/任意配置的 unknown 是业务允许的 JSON 值，不是没有约束的 schema。
  if (type.flags & (ts.TypeFlags.Unknown | ts.TypeFlags.Any | ts.TypeFlags.NonPrimitive)) return json;
  const name = type.aliasSymbol?.getName() ?? type.getSymbol()?.getName() ?? '';
  if (/^(?:ZodStandardJSONSchemaPayload|JSONSchema|JsonSchema)$/.test(name)) return { type: 'object', additionalProperties: json };
  const properties = checker.getPropertiesOfType(type);
  const index = checker.getIndexTypeOfType(type, ts.IndexKind.String);
  if (index && properties.length === 0) return { type: 'object', additionalProperties: schema(index, location) };
  if (properties.length === 0) return json;
  if (ids.has(type.id)) return { $ref: `#/$defs/${ids.get(type.id)}` };
  const id = `T${ids.size + 1}`;
  ids.set(type.id, id);
  definitions[id] = {};
  const fields = {}, required = [];
  for (const property of properties) {
    const key = property.getName();
    const value = checker.getTypeOfSymbolAtLocation(property, property.valueDeclaration ?? property.declarations?.[0] ?? location);
    if (!serializable(value)) continue;
    fields[key] = schema(value, location, key);
    if (!(property.flags & ts.SymbolFlags.Optional) && !(value.isUnion() && value.types.some(t => t.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Void)))) required.push(key);
  }
  definitions[id] = { ...object(fields, required), ...(index ? { additionalProperties: schema(index, location) } : {}) };
  return { $ref: `#/$defs/${id}` };
}
const wrapped = (result) => object({ replayed: { type: 'boolean' }, result });
// 兼容工具的实际实现已迁到legacy；顶层MCP文件只有协议导出，不再作为生成源。
const files = program.getSourceFiles().filter(f => /\/application\/capabilities\/(?:legacy\/)?[^/]*tools\.ts$/.test(f.fileName)).sort((a,b)=>a.fileName.localeCompare(b.fileName));
for (const sf of files) {
  function visit(node) {
    let name, handler, kind, helper;
    if (ts.isObjectLiteralExpression(node)) {
      const get = key => node.properties.find(p => ts.isPropertyAssignment(p) && p.name.getText(sf) === key)?.initializer;
      const value = get('name');
      // 显式输出契约由唯一注册表直接发布，不能用handler的宽泛类型覆盖。
      if (value && ts.isStringLiteral(value) && !get('outputSchema')) { name = value.text; handler = get('handler'); kind = get('kind')?.text; }
    } else if (ts.isCallExpression(node) && node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && ['tool','read','write','wf'].includes(node.expression.getText(sf))) {
      name = node.arguments[0].text; handler = [...node.arguments].find(a => ts.isArrowFunction(a) || ts.isFunctionExpression(a));
      helper = node.expression.getText(sf); kind = ['read','write'].includes(helper) ? helper : node.arguments[2]?.text;
    }
    if (name && handler) {
      const signature = checker.getSignaturesOfType(checker.getTypeAtLocation(handler), ts.SignatureKind.Call)[0];
      if (!signature) throw new Error(`无法推导 ${name}`);
      const promise = checker.getReturnTypeOfSignature(signature);
      const type = checker.getPromisedTypeOfPromise(promise) ?? promise;
      let result = schema(type, handler);
      // businessTool 把无返回的写操作归一化成 {ok:true}；其余 undefined 在协议上归一化为 null。
      if (type.flags & ts.TypeFlags.Void && !sf.fileName.endsWith('/write-tools.ts')) result = ok;
      if (helper && kind === 'write' && /\/(?:project|work-planning)-tools\.ts$/.test(sf.fileName)) {
        const options = node.arguments.at(-1)?.getText(sf) ?? '';
        if (!/idempotent:\s*false/.test(options)) result = wrapped(result);
      }
      results[name] = result;
      sources[name] = `${path.relative(root, sf.fileName)}:${sf.getLineAndCharacterOfPosition(handler.getStart(sf)).line + 1}`;
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
}
// 动态生成的计划工具按实际 DB 模型细化，避免 union 掩盖实体特有字段。
const dbFile = program.getSourceFile(path.join(root, 'src/db/schema.ts'));
const moduleSymbol = checker.getSymbolAtLocation(dbFile);
const exports = checker.getExportsOfModule(moduleSymbol);
for (const kind of ['milestone','iteration','release','module']) {
  const symbol = exports.find(s => s.name === kind);
  const table = checker.getTypeOfSymbolAtLocation(symbol, symbol.valueDeclaration);
  const row = checker.getPropertyOfType(table, '$inferSelect');
  const rowType = checker.getTypeOfSymbolAtLocation(row, symbol.valueDeclaration);
  const entity = schema(rowType, symbol.valueDeclaration);
  const label = kind[0].toUpperCase() + kind.slice(1);
  if (kind !== 'milestone') results[`plan.get${label}`] = entity;
  results[`plan.create${label}`] = wrapped(entity);
  results[`plan.update${label}`] = wrapped(entity);
  for (const action of ['archive','unarchive']) results[`plan.${action}${label}`] = wrapped(ok);
  const origin = files.find(f => f.fileName.endsWith('/work-planning-tools.ts'));
  for (const operation of ['get','update','archive','unarchive']) { const name = `plan.${operation}${label}`; if (results[name]) sources[name] = `${path.relative(root, origin.fileName)}:dynamic-${kind}`; }
}
const resolve = (s) => s.$ref ? definitions[s.$ref.split('/').at(-1)] : s;
// 原生 SQL 的 Record<string,unknown> 投影在业务定义中明确为字符串。
const projectSummary = object({id:{type:'string'},key:{type:'string'},name:{type:'string'},status:nullable(object({key:{type:'string'},name:{type:'string'},category:{type:'string'}})),workItemCount:{type:'integer'} });
results['project.list'] = object({ items: { type:'array', items:projectSummary }, total:{type:'integer'} });
resolve(results.whoami).properties.visibleProjects = {type:'array',items:object({id:{type:'string'},key:{type:'string'},name:{type:'string'}})};
// JSONB列和原生SQL的领域语义：这些值并非任意JSON。
for (const definition of Object.values(definitions)) {
  const properties = definition.properties;
  if (!properties) continue;
  for (const key of ['requiredStates','allowedRoleIds','requiredFields','approverRoleKeys','escalateRoles','events']) {
    if (properties[key]?.$ref === json.$ref) properties[key] = {type:'array',items:{type:'string'}};
  }
}
const fieldView = resolve(resolve(results['meta.fields']).properties.fields.items);
fieldView.properties.type = {anyOf:[{type:'string'},{type:'array',items:{type:'string'}}]};
fieldView.properties.maxLength = {type:'integer',minimum:1};
const importBatch = resolve(results['import.get']);
importBatch.properties.rows = {type:'array',items:{type:'object',additionalProperties:{type:'string'}}};
importBatch.properties.encoding = nullable({type:'string'});
const mapping = resolve(resolve(results['import.setMapping']).properties.mapping);
Object.assign(mapping.properties, {encoding:{type:'string'},hadBom:{type:'boolean'},delimiter:{type:'string'},header:{type:'array',items:{type:'string'}}});
// setMapping保留持久配置的已有列，TypeScript对象展开不会保留其索引签名。
mapping.additionalProperties = json;
importBatch.properties.errorReport = resolve(results['import.dryRun']).properties.errorReport;
// 累积流用 Record 构造类别桶再展开，TS 推导会丢失这些真实传输字段。
// 固定领域类别保持严格契约，也覆盖 dashboard.widgets.data 复用的结果类型。
const cumulativePoint = resolve(resolve(results['insight.cumulativeFlow']).properties.series.items);
for (const category of ['NOT_STARTED', 'IN_PROGRESS', 'TERMINAL']) {
  cumulativePoint.properties[category] = {type:'integer',minimum:0};
  if (!cumulativePoint.required.includes(category)) cumulativePoint.required.push(category);
}
const workbench = resolve(results['workbench.get']);
const group = resolve(workbench.properties.groups.items);
group.properties.items = {type:'array',items:object({id:{type:'string'},key:{type:'string'},title:{type:'string'},type:{type:'string'},priority:nullable({type:'string'}),dueDate:nullable({type:'string',pattern:'^\\d{4}-\\d{2}-\\d{2}$'}),version:{type:'integer',minimum:1},projectKey:{type:'string'},statusName:{type:'string'},statusKey:{type:'string'},statusCategory:{type:'string'}})};
workbench.properties.attentionItems = group.properties.items;
const unavailable = object({ unavailable:{type:'boolean',const:true},code:{type:'string'},tool:{type:'string'} });
const context = { projectId:{type:'string'},project:results['project.get'] };
for (const [section, tool] of Object.entries({members:'project.members',workflows:'meta.workflow',fields:'meta.fields',customFields:'customField.definitions',iterations:'plan.listIterations',milestones:'plan.listMilestones',releases:'plan.listReleases',modules:'plan.listModules',workItems:'workitem.list'})) context[section] = {anyOf:[results[tool],unavailable]};
results['project.context'] = object(context);
results['notification.markRead'] = {anyOf:[object({ok:{type:'boolean'},scope:{const:'one',type:'string'},id:{type:'string'}}),object({ok:{type:'boolean'},scope:{const:'all',type:'string'}})]};
for (const [name, result] of Object.entries(results)) {
  if (result.$ref === json.$ref || (result.type === 'object' && !result.properties)) throw new Error(`工具 ${name} 的返回类型过于宽泛，必须补充领域契约`);
}
const output = path.join(root, 'src/server/application/tool-output-schemas.generated.ts');
const source = `/** 自动生成：node scripts/generate-tool-output-schemas.mjs。源为实际handler/领域返回类型；不要手工修改。 */\nexport const generatedToolOutputs: { results: Record<string, Record<string, unknown>>; definitions: Record<string, Record<string, unknown>>; sources: Record<string,string> } = ${JSON.stringify({results:Object.fromEntries(Object.entries(results).sort()),definitions,sources},null,2)};\n`;
if (process.argv.includes('--check')) { if (readFileSync(output,'utf8') !== source) { console.error('工具输出契约已漂移，请重新生成并验证'); process.exitCode=1; } }
else writeFileSync(output, source);
console.log(`工具输出契约：${Object.keys(results).length}，共享类型：${Object.keys(definitions).length}`);
