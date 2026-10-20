import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {StudioStore,validateStudioLibrary,StudioError,type StudioLibraryEntry} from '../src/studio-store.js';
import {JsonStateStore} from '../src/state-store.js';
const entry=(text='Başlık'):StudioLibraryEntry=>({id:'lib_reusable_01',name:'Kapak Başlığı',node:{id:'node_reuse_01',kind:'heading',text,style:{color:'#ffffff',fontSize:32},children:[]}});
test('project-scoped reusable components persist atomically and survive Core snapshot reload',()=>{
 const dir=mkdtempSync(join(tmpdir(),'taso-studio-library-'));
 try{
  const state=new JsonStateStore(join(dir,'state.json'));
  let store=new StudioStore([],()=>state.save({...state.load(),studioDocuments:store.list()}));
  const original=store.create('project_A','owner');
  const saved=store.replace('project_A','owner',{expectedVersion:1,pages:original.pages,library:[entry()]});
  assert.equal(saved.library?.length,1);
  assert.equal(saved.library?.[0]?.node.text,'Başlık');
  const snapshot=store.checkpoint('project_A','owner',2,'Kitaplık ilk kayıt');
  assert.equal(snapshot.revisions[0]?.library?.length,1);
  const after=store.replace('project_A','owner',{expectedVersion:2,pages:saved.pages,library:[]});
  assert.equal(after.library?.length,0);
  assert.equal(store.restore('project_A','owner',3,snapshot.revisions[0]!.id).library?.[0]?.name,'Kapak Başlığı');
  const reloaded=new StudioStore(new JsonStateStore(join(dir,'state.json')).load().studioDocuments);
  assert.equal(reloaded.get('project_A')?.library?.[0]?.node.text,'Başlık');
  assert.equal(reloaded.get('project_B'),undefined);
  assert.equal(store.get('project_A')?.library?.[0]?.node.text,'Başlık');
 }finally{rmSync(dir,{recursive:true,force:true})}
});
test('library validation rejects unsafe styles, duplicates, oversized trees and stale versions',()=>{
 assert.equal(validateStudioLibrary([entry()]).length,1);
 assert.throws(()=>validateStudioLibrary([entry(),entry()]),/duplicate library/);
 assert.throws(()=>validateStudioLibrary([{...entry(),name:'<svg>'.repeat(100)}]),/label/);
 assert.throws(()=>validateStudioLibrary([{...entry(),node:{...entry().node,style:{background:'url(javascript:alert(1))'}}}]),/HEX colors/);
 assert.throws(()=>validateStudioLibrary([{...entry(),node:{...entry().node,children:[{...entry().node,id:'node_child_02'}]}}]),/Only sections/);
 assert.throws(()=>validateStudioLibrary(Array.from({length:25},(_,i)=>({...entry(),id:'lib_item_'+i}))),/24 items/);
 const store=new StudioStore();const current=store.create('project_access','owner');
 const after=store.replace('project_access','owner',{expectedVersion:1,pages:current.pages,library:[{...entry(),node:{...entry().node,kind:'text',text:'<script>alert(1)</script>'}}]});
 assert.equal(after.library?.[0]?.node.text,'<script>alert(1)</script>');
 assert.throws(()=>store.replace('project_access','owner',{expectedVersion:1,pages:current.pages,library:[]}),e=>e instanceof StudioError&&e.status===409);
});
