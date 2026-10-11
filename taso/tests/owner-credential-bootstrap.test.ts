import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { prepareProductionOwnerCredential, validOwnerPasswordHash } from '../src/owner-credential-bootstrap.js';

const ENV_KEYS=[
  'NODE_ENV','TASO_OWNER_PASSWORD','TASO_OWNER_PASSWORD_HASH','TASO_OWNER_PASSWORD_HASH_FILE',
  'TASO_AUTH_MIGRATE_OWNER_PASSWORD','TASO_AUTH_ALLOW_INSECURE_BOOTSTRAP',
] as const;

function withCleanEnv(run:()=>void){
  const previous=new Map<string,string|undefined>();
  for(const key of ENV_KEYS){previous.set(key,process.env[key]);delete process.env[key]}
  try{run()}finally{for(const key of ENV_KEYS){const value=previous.get(key);if(value===undefined)delete process.env[key];else process.env[key]=value}}
}

test('production owner plaintext migrates only with explicit flag and is removed from process env',()=>withCleanEnv(()=>{
  const dir=mkdtempSync(join(tmpdir(),'taso-owner-migrate-'));
  try{
    const file=join(dir,'owner.hash');
    process.env.NODE_ENV='production';
    process.env.TASO_OWNER_PASSWORD='A-Strong-Owner-Password-2026!';
    process.env.TASO_AUTH_MIGRATE_OWNER_PASSWORD='1';
    process.env.TASO_OWNER_PASSWORD_HASH_FILE=file;
    const result=prepareProductionOwnerCredential();
    assert.equal(result.source,'migrated');
    assert.equal(process.env.TASO_OWNER_PASSWORD,undefined);
    assert.equal(process.env.TASO_AUTH_MIGRATE_OWNER_PASSWORD,undefined);
    assert.ok(validOwnerPasswordHash(process.env.TASO_OWNER_PASSWORD_HASH));
    assert.equal(readFileSync(file,'utf8').trim(),process.env.TASO_OWNER_PASSWORD_HASH);
    assert.equal(statSync(file).mode&0o777,0o600);
  }finally{rmSync(dir,{recursive:true,force:true})}
}));

test('production restart loads persisted hash without plaintext',()=>withCleanEnv(()=>{
  const dir=mkdtempSync(join(tmpdir(),'taso-owner-restart-'));
  try{
    const file=join(dir,'owner.hash');
    process.env.NODE_ENV='production';
    process.env.TASO_OWNER_PASSWORD='A-Strong-Owner-Password-2026!';
    process.env.TASO_AUTH_MIGRATE_OWNER_PASSWORD='1';
    process.env.TASO_OWNER_PASSWORD_HASH_FILE=file;
    prepareProductionOwnerCredential();
    const persisted=readFileSync(file,'utf8').trim();
    delete process.env.TASO_OWNER_PASSWORD_HASH;
    process.env.TASO_OWNER_PASSWORD='must-not-reach-auth';
    delete process.env.TASO_AUTH_MIGRATE_OWNER_PASSWORD;
    const result=prepareProductionOwnerCredential();
    assert.equal(result.source,'file');
    assert.equal(process.env.TASO_OWNER_PASSWORD_HASH,persisted);
    assert.equal(process.env.TASO_OWNER_PASSWORD,undefined);
  }finally{rmSync(dir,{recursive:true,force:true})}
}));

test('production plaintext is not accepted without explicit migration flag',()=>withCleanEnv(()=>{
  const dir=mkdtempSync(join(tmpdir(),'taso-owner-deny-'));
  try{
    const file=join(dir,'owner.hash');
    process.env.NODE_ENV='production';
    process.env.TASO_OWNER_PASSWORD='A-Strong-Owner-Password-2026!';
    process.env.TASO_OWNER_PASSWORD_HASH_FILE=file;
    const result=prepareProductionOwnerCredential();
    assert.equal(result.source,'missing');
    assert.equal(process.env.TASO_OWNER_PASSWORD_HASH,undefined);
    assert.equal(readFileSyncSafe(file),undefined);
  }finally{rmSync(dir,{recursive:true,force:true})}
}));

test('invalid persisted owner hash fails closed',()=>withCleanEnv(()=>{
  const dir=mkdtempSync(join(tmpdir(),'taso-owner-invalid-'));
  try{
    const file=join(dir,'owner.hash');
    writeFileSync(file,'not-a-valid-hash\n',{mode:0o600});
    process.env.NODE_ENV='production';
    process.env.TASO_OWNER_PASSWORD_HASH_FILE=file;
    assert.throws(()=>prepareProductionOwnerCredential(),/Persisted owner password hash is invalid/);
  }finally{rmSync(dir,{recursive:true,force:true})}
}));

function readFileSyncSafe(path:string){try{return readFileSync(path,'utf8')}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw error}}
