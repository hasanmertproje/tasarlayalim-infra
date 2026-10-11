import { randomBytes, scryptSync } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const DEFAULT_HASH_FILE = '/data/taso-owner-password.hash';
const SCRYPT_SCHEME = 'scrypt';

function validBase64(value:string){
  if(!value || value.length%4===1 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value))return false;
  try{return Buffer.from(value,'base64').length>0}catch{return false}
}

export function validOwnerPasswordHash(value:string|undefined){
  if(!value)return false;
  const [scheme,saltB64,hashB64,...extra]=value.trim().split('$');
  if(extra.length || scheme!==SCRYPT_SCHEME || !saltB64 || !hashB64)return false;
  if(!validBase64(saltB64)||!validBase64(hashB64))return false;
  const salt=Buffer.from(saltB64,'base64'),hash=Buffer.from(hashB64,'base64');
  return salt.length>=16&&hash.length===32;
}

export function createOwnerPasswordHash(password:string){
  if(!password)throw new Error('Owner password is empty.');
  const salt=randomBytes(16),hash=scryptSync(password,salt,32);
  return `${SCRYPT_SCHEME}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function persistHash(path:string,hash:string){
  mkdirSync(dirname(path),{recursive:true,mode:0o700});
  const tmp=`${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try{
    writeFileSync(tmp,`${hash}\n`,{encoding:'utf8',mode:0o600,flag:'wx'});
    chmodSync(tmp,0o600);
    renameSync(tmp,path);
    chmodSync(path,0o600);
  }finally{
    if(existsSync(tmp))rmSync(tmp,{force:true});
  }
}

export function prepareProductionOwnerCredential(){
  if(process.env.NODE_ENV!=='production'||process.env.TASO_AUTH_ALLOW_INSECURE_BOOTSTRAP==='1')return{source:'not-required' as const};

  const configured=process.env.TASO_OWNER_PASSWORD_HASH?.trim();
  if(configured){
    if(!validOwnerPasswordHash(configured))throw new Error('TASO_OWNER_PASSWORD_HASH has an invalid scrypt format.');
    delete process.env.TASO_OWNER_PASSWORD;
    return{source:'environment' as const};
  }

  const hashFile=process.env.TASO_OWNER_PASSWORD_HASH_FILE?.trim()||DEFAULT_HASH_FILE;
  if(existsSync(hashFile)){
    const persisted=readFileSync(hashFile,'utf8').trim();
    if(!validOwnerPasswordHash(persisted))throw new Error('Persisted owner password hash is invalid.');
    process.env.TASO_OWNER_PASSWORD_HASH=persisted;
    delete process.env.TASO_OWNER_PASSWORD;
    return{source:'file' as const,path:hashFile};
  }

  const plaintext=process.env.TASO_OWNER_PASSWORD;
  if(!plaintext)return{source:'missing' as const,path:hashFile};

  const hash=createOwnerPasswordHash(plaintext);
  persistHash(hashFile,hash);
  process.env.TASO_OWNER_PASSWORD_HASH=hash;
  delete process.env.TASO_OWNER_PASSWORD;
  return{source:'migrated' as const,path:hashFile};
}
