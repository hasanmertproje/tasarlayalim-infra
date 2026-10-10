import { IdentityStore } from './identity-store.js';

/** Opt-in, expiring QA identity for an isolated preview. Never enables an existing account. */
export function initializePreviewQa(identities:IdentityStore) {
  const email=process.env.TASO_PREVIEW_QA_EMAIL?.trim();
  if(!email)return()=>{};
  if(process.env.TASO_DEPLOYMENT_ENV!=='preview')throw new Error('QA identity is allowed only in an explicitly isolated preview.');
  const expiry=Number(process.env.TASO_PREVIEW_QA_EXPIRES_AT);
  const remaining=expiry-Date.now();
  const existing=identities.getUserByEmail(email);
  if(existing?.owner)throw new Error('QA identity cannot be the owner.');
  if(!Number.isFinite(expiry)||remaining>60*60_000)throw new Error('QA identity needs an expiry within one hour.');
  if(remaining<=0){if(existing?.active)identities.updateUser(existing.id,{active:false});return()=>{}}
  const disable=(userId:string)=>{const current=identities.getUserById(userId);if(current?.active)identities.updateUser(userId,{active:false})};
  if(existing){const timer=setTimeout(()=>disable(existing.id),remaining);timer.unref();return()=>clearTimeout(timer)}
  const password=process.env.TASO_PREVIEW_QA_PASSWORD;
  if(!password||password.length<32)throw new Error('QA identity requires a strong temporary credential.');
  const user=identities.createUser({email,displayName:'Preview QA',roleIds:['role_admin'],password,passwordChangeRequired:false});
  const timer=setTimeout(()=>disable(user.id),remaining);timer.unref();
  return()=>clearTimeout(timer);
}
