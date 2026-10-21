from playwright.sync_api import sync_playwright
from pathlib import Path
import json
root=Path(__file__).resolve().parents[1];html=(root/'TASO-NEXT-LAB-ANDROID.html').read_text()
results=[]
def run(label,fn):
 try:fn();results.append((label,'PASS'));print('PASS',label,flush=True)
 except Exception as e:results.append((label,'FAIL',str(e)[:220]));print('FAIL',label,str(e)[:220],flush=True)
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
 for width in (320,360,390,430,768,1024,1440,1920):
  page=browser.new_page(viewport={'width':width,'height':844 if width<700 else 900});page.set_default_timeout(1800)
  errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.set_content(html,wait_until='load');
  def viewport():
   assert page.locator('main h1').count()>0
   assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth+1'),f'overflow: {page.evaluate("document.documentElement.scrollWidth")} > {width}'
   assert not errors,errors
  run('responsive-overview-'+str(width),viewport)
  if width in (390,1440):
   page.screenshot(path=str(root/f'qa/overview-{width}.png'),full_page=False)
   def flow():
    if width==390:page.locator('.mobile-dock button').nth(1).click()
    else:page.locator('.nav-rail .nav-item').filter(has_text='Projeler').first.click()
    page.get_by_role('tab',name='Görevler').click()
    page.get_by_placeholder('En az beş karakter').fill('QA test görevi')
    page.get_by_role('button',name='Görev ekle').click()
    page.get_by_role('button',name='Demo başlat').click()
    page.get_by_role('button',name='İncelemeye gönder').click()
    page.get_by_role('button',name='Onayı incele').click()
    page.get_by_role('button',name='Onayla').last.click()
    assert page.get_by_text('QA test görevi').count()>0
    assert not errors,errors
   run('hub-approval-'+str(width),flow)
   page.screenshot(path=str(root/f'qa/hub-{width}.png'),full_page=False)
   def studio():
    if width==390:page.locator('.mobile-dock button').nth(2).click()
    else:page.locator('.nav-rail .nav-item').filter(has_text='Studio').first.click()
    if width==390:page.get_by_role('tab',name='Özellikler').click()
    page.get_by_label('Metin içeriği').fill('Yeni özgün TASO başlığı')
    if width==390:page.get_by_role('tab',name='Yüzey').click()
    assert page.locator('.preview-block h2').get_by_text('Yeni özgün TASO başlığı').is_visible()
    assert not errors,errors
   run('studio-edit-'+str(width),studio)
   page.screenshot(path=str(root/f'qa/studio-{width}.png'),full_page=False)
   def voice():
    if width==390:page.locator('.mobile-dock button').nth(3).click()
    else:page.locator('.nav-rail .nav-item').filter(has_text='Voice').first.click()
    page.get_by_role('button',name='Demo oturumu başlat').click()
    page.get_by_role('button',name='Tur oluştur').click()
    page.get_by_role('button',name='Demo yanıtı göster').click()
    page.get_by_role('button',name='Bitir').click()
    assert page.get_by_text('Oturum bekliyor').is_visible()
    assert not errors,errors
   run('voice-demo-'+str(width),voice)
   page.screenshot(path=str(root/f'qa/voice-{width}.png'),full_page=False)
   def navigation():
    # JS DOM click is used only for exhaustive route rendering; actual physical taps are tested above.
    page.evaluate("document.querySelector('.context-switch button').click()")
    admin=page.locator('.nav-rail .nav-item').count(); assert admin==19,admin
    for i in range(admin):
     page.evaluate('(i)=>document.querySelectorAll(".nav-rail .nav-item")[i].click()',i)
     assert page.locator('main h1').count()>0,('admin',i)
    page.evaluate("document.querySelectorAll('.context-switch button')[1].click()")
    workspace=page.locator('.nav-rail .nav-item').count();assert workspace==16,workspace
    for i in range(workspace):
     page.evaluate('(i)=>document.querySelectorAll(".nav-rail .nav-item")[i].click()',i)
     assert page.locator('main h1').count()>0,('workspace',i)
    assert not errors,errors
   run('35-nav-render-'+str(width),navigation)
  page.close()
 browser.close()
(root/'qa/results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
print('RESULT',sum(x[1]=='PASS' for x in results),'/',len(results),flush=True)
if any(x[1]=='FAIL' for x in results):raise SystemExit(1)