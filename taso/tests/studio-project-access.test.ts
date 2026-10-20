import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { registerGatewayAuthorizer } from '../src/gateway-authorizer.js';

function createAuth(access:{read:boolean;write:boolean}|null, owner=false){
 const app=Fastify();
 const user={id:'user_studio',email:'studio@example.com',active:true,owner};
 const auth={requireSession:()=>undefined,currentUser:()=>user} as any;
 const identities={can:(_user:unknown,permission:string)=>['projects.read','projects.write'].includes(permission)} as any;
 const control={getSnapshot:()=>({emergency:{maintenanceMode:false,readOnly:false,writesDisabled:false,browserOperatorDisabled:false,productionDeployDisabled:false},projectAccess:access?[{userId:'user_studio',projectId:'project_a',read:access.read,write:access.write,approve:false,deploy:false,environments:[]}]:[]})} as any;
 registerGatewayAuthorizer(app,auth,identities,control);
 return app;
}
test('Nginx /api/v1 prefix is normalized; project membership required for Studio reads',async()=>{
 const app=createAuth(null);
 const res=await app.inject({url:'/auth/authorize',headers:{'x-taso-original-uri':'/api/v1/projects/project_a/studio','x-taso-original-method':'GET'}});
 assert.equal(res.statusCode,403);
 await app.close();
});
test('Studio edit requires per-project write even when global projects.write exists',async()=>{
 const app=createAuth({read:true,write:false});
 const read=await app.inject({url:'/auth/authorize',headers:{'x-taso-original-uri':'/api/v1/projects/project_a/studio','x-taso-original-method':'GET'}});
 const write=await app.inject({url:'/auth/authorize',headers:{'x-taso-original-uri':'/api/v1/projects/project_a/studio/revisions','x-taso-original-method':'POST'}});
 assert.equal(read.statusCode,204);assert.equal(write.statusCode,403);
 await app.close();
});
test('Project member with editor access may update Studio; direct access to other project denied',async()=>{
 const app=createAuth({read:true,write:true});
 const write=await app.inject({url:'/auth/authorize',headers:{'x-taso-original-uri':'/api/v1/projects/project_a/studio','x-taso-original-method':'PUT'}});
 const cross=await app.inject({url:'/auth/authorize',headers:{'x-taso-original-uri':'/api/v1/projects/project_b/studio','x-taso-original-method':'GET'}});
 assert.equal(write.statusCode,204);assert.equal(cross.statusCode,403);
 await app.close();
});
