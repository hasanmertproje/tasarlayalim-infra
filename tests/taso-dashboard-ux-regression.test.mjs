import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = file => readFileSync(new URL('../taso-ui/src/'+file,import.meta.url),'utf8');
test('navigation keeps API-facing route IDs stable while all visible titles are Turkish',()=>{
  const navigation=src('navigation.ts');
  const names=['Command Center','Projects','Tasks','Approvals','Deployments','AI Agents','Knowledge','Integrations','Monitoring','Settings','Notifications','Infrastructure'];
  const start=navigation.indexOf('TASO_SCREEN_LABELS:');
  assert.ok(start>0);
  const entries=navigation.slice(start,navigation.indexOf('};',start));
  for (const name of names) {
    assert.ok(entries.includes(name.includes(' ')?"'"+name+"'":name+':'),name+' label map');
  }
  const app=src('App.tsx'),mobile=src('MobileNavigationHub.tsx');
  assert.ok(app.includes('tasoScreenLabel(item)'));
  assert.ok(app.includes('tasoScreenLabel(activeNav)'));
  assert.ok(mobile.includes('tasoScreenLabel(screen)'));
  assert.ok(mobile.includes('tasoScreenLabel(active)'));
  assert.ok(app.includes('navigateTaso')===false || !app.includes("navigateTaso(tasoScreenLabel("));
});
test('dashboard preserves capability truth and internal write risk enum',()=>{
  const command=src('CommandCenterV29.tsx');
  assert.match(command,/cap\('preview-deploy'\)&&health\.executor\?\.deploy/);
  assert.match(command,/value="HIGH_IMPACT">Yüksek etkili işlem/);
  assert.match(command,/value="WRITE">Değişiklik yap/);
  assert.match(command,/>\{ready\?'Hazır':'Hazır değil'\}<\/strong>/);
  assert.ok(!command.includes('Missionlar ↗'));
  assert.ok(!command.includes('aktif mission'));
});
test('dashboard header reserves space for fixed session/theme controls and responsive fallbacks',()=>{
  const css=src('command-center-v29.css');
  assert.match(css,/\.cc29-shell \.cc29-top\{\s*padding-right:/);
  assert.match(css,/@media\(max-width:1250px\)/);
  assert.match(css,/@media\(max-width:760px\)/);
  const global=src('GlobalUiControlsV11.tsx');
  assert.ok(global.includes("'AÇIK' : 'KOYU'"));
});
