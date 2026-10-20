import assert from 'node:assert/strict';
import test from 'node:test';
import { buildServer } from '../src/server.js';
import { registerRequestIdentityContext } from '../src/request-context.js';

test('Studio HTTP workflow: project -> create -> add node -> checkpoint -> restore with gateway claims',async()=>{
 const old=process.env.TASO_GATEWAY_SECRET;process.env.TASO_GATEWAY_SECRET='ci-studio-gateway';
 const app=buildServer();registerRequestIdentityContext(app);
 const baseHeaders={'x-taso-gateway':'ci-studio-gateway','x-taso-user-id':'ci_operator','x-taso-permission':'projects.read'};
 const editHeaders={...baseHeaders,'x-taso-permission':'projects.write'};
 try{
  const projects=await app.inject({method:'GET',url:'/v1/projects',headers:baseHeaders});
  assert.equal(projects.statusCode,200);
  const createProject=await app.inject({method:'POST',url:'/v1/projects',headers:editHeaders,payload:{name:'Studio CI',slug:'studio-ci',repository:'ci/studio',isExisting:true}});
  assert.equal(createProject.statusCode,201);
  const projectId=createProject.json().project.id as string;const base='/v1/projects/'+projectId+'/studio';
  const unauth=await app.inject({method:'GET',url:base,headers:{'x-taso-gateway':'ci-studio-gateway'}});
  assert.equal(unauth.statusCode,403);
  const unauthorized=await app.inject({method:'POST',url:base,headers:baseHeaders,payload:{title:'Denied'}});
  assert.equal(unauthorized.statusCode,403);
  const empty=await app.inject({method:'GET',url:base,headers:baseHeaders});assert.equal(empty.statusCode,200);assert.equal(empty.json().document,null);
  const created=await app.inject({method:'POST',url:base,headers:editHeaders,payload:{title:'CI Website'}});
  assert.equal(created.statusCode,201);
  const document=created.json().document;assert.equal(document.projectId,projectId);
  const page=document.pages[0];
  const changed=await app.inject({method:'PUT',url:base,headers:editHeaders,payload:{expectedVersion:1,pages:[{...page,nodes:[{id:'node_001',kind:'heading',text:'Başlık V1',style:{color:'#ffffff'},children:[]}]}]}});
  assert.equal(changed.statusCode,200);
  const revision=await app.inject({method:'POST',url:base+'/revisions',headers:editHeaders,payload:{expectedVersion:2,label:'İlk sürüm'}});
  assert.equal(revision.statusCode,201);
  const version=revision.json().document.revisions[0].id as string;
  const changed2=await app.inject({method:'PUT',url:base,headers:editHeaders,payload:{expectedVersion:2,pages:[{...page,nodes:[{id:'node_001',kind:'heading',text:'Başlık V2',style:{color:'#ffffff'},children:[]}]}]}});
  assert.equal(changed2.statusCode,200);
  const stale=await app.inject({method:'PUT',url:base,headers:editHeaders,payload:{expectedVersion:2,pages:[page]}});
  assert.equal(stale.statusCode,409);
  const restored=await app.inject({method:'POST',url:base+'/revisions/'+version+'/restore',headers:editHeaders,payload:{expectedVersion:3}});
  assert.equal(restored.statusCode,200);
  assert.equal(restored.json().document.pages[0].nodes[0].text,'Başlık V1');
  const persisted=await app.inject({method:'GET',url:base,headers:baseHeaders});assert.equal(persisted.statusCode,200);assert.equal(persisted.json().document.version,4);
 }finally{await app.close();if(old===undefined)delete process.env.TASO_GATEWAY_SECRET;else process.env.TASO_GATEWAY_SECRET=old}
});
