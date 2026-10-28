import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { AuthSecurityStore } from '../src/auth-security.js';

test('TOTP secret, recovery codes, trusted devices and revocations survive store restart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'taso-auth-persistence-'));
  const file = join(dir, 'secure', 'auth.json');
  const before = {
    file: process.env.TASO_AUTH_SECURITY_FILE,
    key: process.env.TASO_AUTH_ENCRYPTION_KEY,
  };
  try {
    process.env.TASO_AUTH_SECURITY_FILE = file;
    process.env.TASO_AUTH_ENCRYPTION_KEY = 'a'.repeat(64);
    const first = new AuthSecurityStore('owner');
    first.setTotpSecret('owner', 'JBSWY3DPEHPK3PXP');
    first.setRecoveryCodes('owner', ['ABCD-EFGH', 'IJKL-MNOP']);
    const trusted = first.createTrustedDevice('owner', {token:'device-test-token',label:'Test phone'});
    assert.equal(first.hasTotp('owner'), true);
    const serialized = readFileSync(file, 'utf8');
    assert.equal(serialized.includes('JBSWY3DPEHPK3PXP'), false);
    assert.equal(serialized.includes('device-test-token'), false);
    assert.equal(serialized.includes('ABCD-EFGH'), false);

    const restarted = new AuthSecurityStore('owner');
    assert.equal(restarted.getTotpSecret('owner'), 'JBSWY3DPEHPK3PXP');
    assert.equal(restarted.validateTrustedDevice('owner','device-test-token')?.id, trusted.id);
    assert.equal(restarted.consumeRecoveryCode('owner','ABCD-EFGH'), true);
    const afterConsumption = new AuthSecurityStore('owner');
    assert.equal(afterConsumption.consumeRecoveryCode('owner','ABCD-EFGH'), false);
    assert.equal(afterConsumption.consumeRecoveryCode('owner','IJKL-MNOP'), true);
    assert.equal(afterConsumption.revokeTrustedDevice('owner',trusted.id), true);
    const afterRevocation = new AuthSecurityStore('owner');
    assert.equal(afterRevocation.validateTrustedDevice('owner','device-test-token'), undefined);
    assert.equal(afterRevocation.hasTotp('owner'), true);
  } finally {
    if(before.file===undefined)delete process.env.TASO_AUTH_SECURITY_FILE;else process.env.TASO_AUTH_SECURITY_FILE=before.file;
    if(before.key===undefined)delete process.env.TASO_AUTH_ENCRYPTION_KEY;else process.env.TASO_AUTH_ENCRYPTION_KEY=before.key;
    rmSync(dir, {recursive:true,force:true});
  }
});

test('corrupt persisted auth security state fails closed rather than reenrolling TOTP', () => {
  const dir=mkdtempSync(join(tmpdir(),'taso-auth-corrupt-'));
  const file=join(dir,'auth.json');
  const previous=process.env.TASO_AUTH_SECURITY_FILE;
  const previousKey=process.env.TASO_AUTH_ENCRYPTION_KEY;
  try {
    process.env.TASO_AUTH_SECURITY_FILE=file;
    process.env.TASO_AUTH_ENCRYPTION_KEY='b'.repeat(64);
    writeFileSync(file,'{broken-json');
    assert.throws(()=>new AuthSecurityStore('owner'),/security state/i);
  } finally {
    if(previous===undefined)delete process.env.TASO_AUTH_SECURITY_FILE;else process.env.TASO_AUTH_SECURITY_FILE=previous;
    if(previousKey===undefined)delete process.env.TASO_AUTH_ENCRYPTION_KEY;else process.env.TASO_AUTH_ENCRYPTION_KEY=previousKey;
    rmSync(dir,{recursive:true,force:true});
  }
});

test('a failed storage write restores recovery-code and trusted-device state in memory', () => {
  const dir=mkdtempSync(join(tmpdir(),'taso-auth-failure-'));
  const beforeFile=process.env.TASO_AUTH_SECURITY_FILE, beforeKey=process.env.TASO_AUTH_ENCRYPTION_KEY;
  try {
    process.env.TASO_AUTH_SECURITY_FILE=join(dir,'auth.json');
    process.env.TASO_AUTH_ENCRYPTION_KEY='e'.repeat(64);
    const security=new AuthSecurityStore('owner');
    security.setRecoveryCodes('owner',['VALID-RECOVERY-CODE']);
    const withSave=security as unknown as {save:()=>void};
    const original=withSave.save;
    try {
      withSave.save=()=>{throw new Error('Synthetic disk write failure')};
      assert.throws(()=>security.consumeRecoveryCode('owner','VALID-RECOVERY-CODE'),/Synthetic disk write failure/);
      assert.throws(()=>security.createTrustedDevice('owner',{token:'test-token',label:'Test Android'}),/Synthetic disk write failure/);
      assert.equal(security.listTrustedDevices('owner').length,0);
    } finally {
      withSave.save=original;
    }
    assert.equal(security.consumeRecoveryCode('owner','VALID-RECOVERY-CODE'),true);
    assert.equal(security.consumeRecoveryCode('owner','VALID-RECOVERY-CODE'),false);
    assert.equal(security.listTrustedDevices('owner').length,0);
  } finally {
    if(beforeFile===undefined)delete process.env.TASO_AUTH_SECURITY_FILE;else process.env.TASO_AUTH_SECURITY_FILE=beforeFile;
    if(beforeKey===undefined)delete process.env.TASO_AUTH_ENCRYPTION_KEY;else process.env.TASO_AUTH_ENCRYPTION_KEY=beforeKey;
    rmSync(dir,{recursive:true,force:true});
  }
});
