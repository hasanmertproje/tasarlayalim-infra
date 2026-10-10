import assert from 'node:assert/strict';
import Fastify from 'fastify';
import test from 'node:test';
import { registerGatewayAuthorizer } from '../src/gateway-authorizer.js';

function setup(input:{permissions:string[];owner?:boolean;emergency?:Record<string,boolean>;access?:unknown[]}){
 const app=Fastify();
 const user={id:'user_test',email:'test@example.com',active:true,owner:Boolean(input.owner)};
 const auth={requireSession:()=>undefined,currentUser:()=>user} as any;
 const identities={can:(_user:unknown,permission:string)=>input.permissions.includes(permission)} as any;
 const control={getSnapshot:()=>({emergency:{maintenanceMode:false,readOnly:false,writesDisabled:false,browserOperatorDisabled:false,productionDeployDisabled:false,...input.emergency},projectAccess:input.access??[]})} as any;
 registerGatewayAuthorizer(app,auth,identities,control);return app;
}

test('viewer permission cannot perform project write',async()=>{const app=setup({permissions:['projects.read']});const res=await app.inject({method:'GET',url:'/auth/authorize',headers:{'x-taso-original-uri':'/v1/projects','x-taso-original-method':'POST'}});assert.equal(res.statusCode,403);await app.close()});
test('emergency read-only blocks writes even for permitted user',async()=>{const app=setup({permissions:['missions.write'],emergency:{readOnly:true}});const res=await app.inject({method:'GET',url:'/auth/authorize',headers:{'x-taso-original-uri':'/v1/missions','x-taso-original-method':'POST'}});assert.equal(res.statusCode,423);await app.close()});
test('project-specific access rejects non-owner without matrix rule',async()=>{const app=setup({permissions:['projects.read']});const res=await app.inject({method:'GET',url:'/auth/authorize',headers:{'x-taso-original-uri':'/v1/projects/project_a/knowledge','x-taso-original-method':'GET'}});assert.equal(res.statusCode,403);await app.close()});
test('project-specific access allows configured read',async()=>{const app=setup({permissions:['projects.read'],access:[{userId:'user_test',projectId:'project_a',environments:['dev'],read:true,write:false,approve:false,deploy:false}]});const res=await app.inject({method:'GET',url:'/auth/authorize',headers:{'x-taso-original-uri':'/v1/projects/project_a/knowledge','x-taso-original-method':'GET'}});assert.equal(res.statusCode,204);await app.close()});
