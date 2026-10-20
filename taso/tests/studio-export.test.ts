import assert from 'node:assert/strict';
import test from 'node:test';
import { buildServer } from '../src/server.js';
import { registerRequestIdentityContext } from '../src/request-context.js';
import { studioPageHtml } from '../src/studio-export.js';

test('HTML export is from authoritative saved Studio tree, escaped and permission gated',async()=>{
 const old=process.env.TASO_GATEWAY_SECRET;process.env.TASO_GATEWAY_SECRET='ci-export-gateway';
 const app=buildServer();registerRequestIdentityContext(app);
 const read={'x-taso-gateway':'ci-export-gateway','x-taso-user-id':'ci_export','x-taso-permission':'projects.read'};
 const write={...read,'x-taso-permission':'projects.write'};
 try{
  const createdProject=await app.inject({method:'POST',url:'/v1/projects',headers:write,payload:{name:'HTML Export',slug:'studio-html-export',repository:'qa/export',isExisting:true}});
  assert.equal(createdProject.statusCode,201);
  const projectId=createdProject.json().project.id as string;
  const base='/v1/projects/'+projectId+'/studio';
  const docResult=await app.inject({method:'POST',url:base,headers:write,payload:{title:'Site'}});
  assert.equal(docResult.statusCode,201);
  const page=docResult.json().document.pages[0];
  const exportUrl=base+'/pages/'+page.id+'/export.html';
  assert.equal((await app.inject({method:'GET',url:exportUrl,headers:{'x-taso-gateway':'ci-export-gateway'}})).statusCode,403);
  assert.equal((await app.inject({method:'GET',url:base+'/pages/other/export.html',headers:read})).statusCode,404);
  const text='<script>alert("hack")</script> & <img onerror=alert(1)>';
  const changed=await app.inject({method:'PUT',url:base,headers:write,payload:{expectedVersion:1,pages:[{...page,nodes:[{id:'node_export1',kind:'heading',text,style:{color:'#ABCDEF',fontSize:32,textAlign:'center',fontWeight:700},children:[]}]}]}});
  assert.equal(changed.statusCode,200);
  const saved=changed.json().document.pages[0];
  const exportResponse=await app.inject({method:'GET',url:exportUrl,headers:read});
  assert.equal(exportResponse.statusCode,200);
  assert.match(exportResponse.headers['content-type'] as string,/text\/html/);
  assert.match(exportResponse.headers['content-disposition'] as string,/attachment; filename="taso-ana-sayfa.html"/);
  assert.match(exportResponse.headers['content-security-policy'] as string,/sandbox/);
  assert.match(exportResponse.headers['cache-control'] as string,/no-store/);
  assert.equal(exportResponse.body,studioPageHtml(saved));
  assert.ok(exportResponse.body.includes('&lt;script&gt;alert(&quot;hack&quot;)&lt;/script&gt;'));
  assert.ok(!exportResponse.body.includes('<script>'));
  assert.ok(!exportResponse.body.includes('<img '));
  assert.ok(exportResponse.body.includes('font-weight:700'));
  assert.ok(exportResponse.body.includes('<h2 data-node-id="node_export1"'));
 }finally{await app.close();if(old===undefined)delete process.env.TASO_GATEWAY_SECRET;else process.env.TASO_GATEWAY_SECRET=old}
});
