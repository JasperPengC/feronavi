/** 只读核对已授权本机预览的RAG验收结果，不创建或删除数据。 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {sql} from '../src/db/index.ts';
const folder='.cache/rag-workspace-20261115';
const state=JSON.parse(await fs.readFile(`${folder}/state.json`,'utf8'));
assert.equal(new URL(process.env.DATABASE_URL).pathname,'/feronavi_test_d367a4bb86c44c80b2ecf895f46241d6');
try {
  assert.ok(state.finishedAt && !state.error && state.checks.every(c=>c.passed));
  const [migration]=await sql`select count(*)::int as count from drizzle.__drizzle_migrations`;
  assert.equal(migration.count,69);
  const ids=Object.values(state.resources).map(p=>p.id);
  const pages=await sql`select p.id,p.title,j.generation,count(c.id)::int as chunks,count(e.id)::int as vectors,array_agg(distinct vector_dims(e.vector)) as dimensions,array_agg(distinct e.model) as models from page p join lateral (select generation from index_job where page_id=p.id and status='SUCCEEDED' and activated_at is not null and generation <= (select (value #>> '{}')::int from setting where key='knowledge.active_generation') order by generation desc limit 1) j on true left join page_chunk c on c.page_id=p.id and c.revision_id=p.current_revision_id and c.generation=j.generation left join chunk_embedding e on e.chunk_id=c.id where p.id in ${sql(ids)} and p.deleted_at is null group by p.id,p.title,j.generation order by p.title`;
  assert.equal(pages.length,3);
  for(const p of pages){assert.ok(p.chunks>0);assert.equal(p.vectors,p.chunks);assert.deepEqual(p.dimensions,[1024]);assert.deepEqual(p.models,['BAAI/bge-m3-1024']);}
  const tokens=await sql`select id,name,revoked_at is not null as revoked from api_token where name in ('独立RAG验收（临时只读）','独立RAG范围隔离（临时只读）') order by name`;
  assert.equal(tokens.length,2);assert.ok(tokens.every(t=>t.revoked));
  assert.ok([state.tokenId,state.restrictedTokenId].every(id=>tokens.some(t=>t.id===id)));
  const bridgeSecretRemoved=await fs.access(`${folder}/bridge-secret.json`).then(()=>false,()=>true);assert.ok(bridgeSecretRemoved);
  const finok={};
  for(const table of ['project','work_item','page','idea','milestone','iteration','release','module']){
    const col=table==='project'?'id':'project_id';
    finok[table]=(await sql.unsafe(`select md5(coalesce(string_agg(row_to_json(t)::text, '' order by id),'')) as hash,count(*)::int as count from ${table} t where ${col}=(select id from project where key='FINOK')`))[0];
  }
  assert.deepEqual(finok,state.finokBefore);assert.deepEqual(finok,state.finokAfter);
  const counts=await sql`select s.category,count(*)::int as count from work_item w join workflow_state s on s.id=w.status_id where w.project_id=${state.projectId} and w.deleted_at is null group by s.category`;
  const total=counts.reduce((n,r)=>n+r.count,0),terminal=counts.filter(r=>r.category==='TERMINAL').reduce((n,r)=>n+r.count,0);
  assert.equal(total,39);assert.equal(terminal,22);
  const releases=await sql`select name,completed_at is not null as completed,(select count(*)::int from work_item where release_id=r.id and deleted_at is null) as items from release r where project_id=${state.projectId}`;
  assert.equal(releases.length,1);assert.ok(releases[0].completed);assert.equal(releases[0].items,18);
  const iterations=await sql`select name,completed_at is not null as completed,completion_result from iteration where project_id=${state.projectId} order by start_date`;
  assert.ok(iterations[0].completed);assert.equal(iterations[0].completion_result.carriedOverCount,10);assert.equal(iterations[1].completed,false);
  const healthResponse=await fetch('http://127.0.0.1:51476/health');assert.equal(healthResponse.status,200);const health=await healthResponse.json();
  const result={verifiedAt:new Date().toISOString(),migrationCount:migration.count,pages,tokens,bridgeSecretRemoved,finokUnchanged:true,finok,business:{total,terminal,open:total-terminal,releases,iterations},health};
  await fs.writeFile(`${folder}/independent-verification.json`,JSON.stringify(result,null,2),{mode:0o600});
  console.log(JSON.stringify({pages:pages.length,currentChunks:pages.reduce((n,p)=>n+p.chunks,0),revokedTokens:tokens.length,bridgeSecretRemoved,finokUnchanged:true,total,terminal,open:total-terminal,migrationCount:migration.count,healthStatus:healthResponse.status}));
} finally {await sql.end();}
