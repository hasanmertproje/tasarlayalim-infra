import { AsyncLocalStorage } from 'node:async_hooks';
import type { FastifyInstance } from 'fastify';

export type RequestIdentityContext={userId?:string;userName?:string;userEmail?:string;permission?:string};
const storage=new AsyncLocalStorage<RequestIdentityContext>();
function header(value:unknown){return typeof value==='string'&&value.trim()?value.trim():undefined}

export function registerRequestIdentityContext(app:FastifyInstance){
  app.addHook('onRequest',(request,_reply,done)=>{
    storage.run({
      userId:header(request.headers['x-taso-user-id']),
      userName:header(request.headers['x-taso-user-name']),
      userEmail:header(request.headers['x-taso-user-email']),
      permission:header(request.headers['x-taso-permission']),
    },done);
  });
}
export function currentRequestIdentity(){return storage.getStore()??{};}
