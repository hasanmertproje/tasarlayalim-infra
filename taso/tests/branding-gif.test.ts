import assert from 'node:assert/strict';
import test from 'node:test';
import { ControlPlaneStore, validateDataUrl } from '../src/control-plane-store.js';

test('large GIF uploads are accepted within the limit; invalid updates are atomic',()=>{
 // Keep Core container tests independent of frontend assets.
 const gif='data:image/gif;base64,'+Buffer.concat([Buffer.from('GIF89a'),Buffer.alloc(4_800_000)]).toString('base64');
 assert.ok(gif.length>6_000_000);
 const store=new ControlPlaneStore();
 assert.equal(store.updateBranding({iconDataUrl:gif}).iconDataUrl,gif);
 const before=store.getSnapshot().branding;
 assert.throws(()=>store.updateBranding({assistantName:'Changed',lightIconDataUrl:'data:image/gif;base64,PHNjcmlwdD4='}),/eşleşmiyor/);
 assert.deepEqual(store.getSnapshot().branding,before);
 assert.equal(store.updateBranding({iconDataUrl:''}).iconDataUrl,undefined);
 assert.throws(()=>validateDataUrl('data:image/gif;base64,'+'A'.repeat(8_388_608)),/6 MiB/);
});
