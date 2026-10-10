import type { FastifyInstance } from 'fastify';
import type { AuthService } from './auth.js';
import type { ControlPlaneStore } from './control-plane-store.js';

function eventType(method:string,url:string,status:number){
 if(url==='/auth/login')return status>=400?'auth.login_failed':'auth.login_attempt_accepted';
 if(url.startsWith('/auth/2fa/setup/confirm'))return status>=400?'auth.2fa_setup_failed':'auth.2fa_enabled';
 if(url.startsWith('/auth/2fa/verify'))return status>=400?'auth.2fa_failed':'auth.2fa_verified';
 if(url.startsWith('/auth/password/change'))return status>=400?'auth.password_change_failed':'auth.password_changed';
 if(url.startsWith('/auth/trusted-devices'))return status>=400?'auth.trusted_device_action_failed':'auth.trusted_device_changed';
 if(url==='/auth/logout')return 'auth.logout';
 if(url.startsWith('/auth/admin/'))return status>=400?'admin.identity_action_failed':'admin.identity_changed';
 if(url.startsWith('/v1/')&&!['GET','HEAD','OPTIONS'].includes(method))return status>=400?'product.write_failed':'product.write';
 return undefined;
}

export function registerAuditHooks(app:FastifyInstance,auth:AuthService,store:ControlPlaneStore){
 app.addHook('onResponse',async(request,reply)=>{
  const type=eventType(request.method,request.url,reply.statusCode);if(!type)return;
  const user=auth.currentUser(request);
  store.appendAudit({actorId:user?.id,type,scope:request.url.split('?')[0]?.slice(0,180),highImpact:/password|admin|deploy|production|emergency/i.test(request.url),detail:{method:request.method,status:reply.statusCode}});
 });
}
