import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync,readFileSync,rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { StudioError, StudioStore } from '../src/studio-store.js';
import { JsonStateStore } from '../src/state-store.js';
import type { StudioNode } from '../src/studio-store.js';

const node=(kind:StudioNode['kind']='heading',text='Başlık'):StudioNode=>({id:'node_test1',kind,text,style:{fontSize:28,color:'#ffffff'},children:[]});

test('studio document: create, edit, checkpoint, restore, and atomic disk rehydration',()=>{
 const directory=mkdtempSync(join(tmpdir(),'taso-studio-'));
 try{
  const state=new JsonStateStore(join(directory,'state.json'));
  let documents=new StudioStore([],()=>state.save({...state.load(),studioDocuments:documents.list()}));
  const created=documents.create('project_test','actor_one','My Design');
  assert.equal(created.pages.length,1);
  assert.equal(created.version,1);
  const pages=[{...created.pages[0],nodes:[node()]}];
  const changed=documents.replace('project_test','actor_one',{expectedVersion:1,pages});
  assert.equal(changed.pages[0]?.nodes[0]?.text,'Başlık');
  assert.equal(changed.version,2);
  const archived=documents.checkpoint('project_test','actor_one',2,'Initial hero');
  assert.equal(archived.revisions.length,1);
  const revisionId=archived.revisions[0]!.id;
  const newer=documents.replace('project_test','actor_one',{expectedVersion:2,pages:[{...pages[0],nodes:[{...node(),text:'Değiştirildi'}]}]});
  assert.equal(newer.pages[0]?.nodes[0]?.text,'Değiştirildi');
  assert.equal(documents.restore('project_test','actor_two',3,revisionId).pages[0]?.nodes[0]?.text,'Başlık');
  assert.equal(documents.get('project_test')?.version,4);
  const disk=JSON.parse(readFileSync(join(directory,'state.json'),'utf8'));
  assert.equal(disk.studioDocuments[0].pages[0].nodes[0].text,'Başlık');
  const reloaded=new StudioStore(new JsonStateStore(join(directory,'state.json')).load().studioDocuments);
  assert.equal(reloaded.get('project_test')?.revisions.length,1);
 }finally{rmSync(directory,{recursive:true,force:true})}
});

test('studio documents: hostile HTML is data, style grammar strict, optimistic locking and bounded trees',()=>{
 const store=new StudioStore();
 const d=store.create('project_1','owner');
 const page=d.pages[0]!;
 assert.throws(()=>store.replace('project_1','owner',{expectedVersion:999,pages:[page]}),e=>e instanceof StudioError&&e.status===409);
 assert.throws(()=>store.replace('project_1','owner',{expectedVersion:1,pages:[{...page,nodes:[{...node(),style:{background:'url(javascript:alert(1))'}}]}]}),/HEX colors/);
 assert.throws(()=>store.replace('project_1','owner',{expectedVersion:1,pages:[{...page,nodes:[node(),node()]}]}),/Duplicate/);
 assert.throws(()=>store.replace('project_1','owner',{expectedVersion:1,pages:[{...page,slug:'../../etc/passwd'}]}),/slug/);
 const s=store.replace('project_1','owner',{expectedVersion:1,pages:[{...page,nodes:[{...node(),text:'<img src=x onerror=alert(1)>'}]}]});
 assert.equal(s.pages[0]?.nodes[0]?.text,'<img src=x onerror=alert(1)>');
 assert.throws(()=>store.replace('project_1','owner',{expectedVersion:1,pages:s.pages}),/changed/);
 assert.throws(()=>store.checkpoint('project_1','owner',2,''),/label/);
 assert.throws(()=>store.restore('project_1','owner',2,'rev_missing'),/not found/);
});
