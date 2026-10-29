import type {StudioBlock} from './domain';

export function escapeHtml(v:string):string {
  return v.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]||c));
}
export type PublisherTech='html'|'react'|'laravel';
export function technologyFiles(tech:PublisherTech):readonly string[] {
  if(tech==='html')return ['index.html','README.md'];
  if(tech==='react')return ['src/App.tsx','src/App.css','package.json','vite.config.ts'];
  return ['resources/views/welcome.blade.php','routes/web.php','composer.json','artisan'];
}
export function renderSiteHtml(blocks:readonly StudioBlock[],name='TASO NEXT'):string {
 const title=escapeHtml(name.slice(0,120));
 const sections=blocks.map((block,i)=>{
  const text=escapeHtml(block.value),label=escapeHtml(block.label);
  if(block.type==='hero')return '<section class="hero" id="block-'+i+'"><div><small>✧ YENİ NESİL DİJİTAL DENEYİM</small><h1>'+text+'</h1><p>Fikrini çalışan bir deneyime dönüştürmek için tasarım ve teknolojiyi bir araya getir.</p><span class="cta">Birlikte üretelim →</span></div><div class="sphere" aria-hidden="true"></div></section>';
  if(block.type==='feature')return '<section class="feature" id="block-'+i+'"><small>'+label+'</small><h2>'+text+'</h2></section>';
  return '<section class="text" id="block-'+i+'"><small>'+label+'</small><p>'+text+'</p></section>';
 }).join('\n');
 const styles=String.raw`*{box-sizing:border-box}body{margin:0;color:#f8f6ff;background:#0c1030;font-family:Inter,system-ui,sans-serif}header{display:flex;justify-content:space-between;align-items:center;gap:14px;background:#090d24;border-bottom:1px solid #383873;padding:20px 6%}.logo{font-size:17px;font-weight:800;display:flex;gap:10px;align-items:center}.logo i{width:25px;height:25px;border-radius:50%;background:radial-gradient(circle at 30% 28%,#acf1ff,#9240f3 45%,#f26dff 75%,#241060);box-shadow:0 0 16px #8950ff}nav{display:flex;gap:20px;font-size:11px;color:#b3bee5}main{max-width:1400px;margin:auto}.hero{min-height:400px;display:grid;align-items:center;grid-template-columns:minmax(0,1.1fr) minmax(130px,.9fr);gap:16px;padding:55px 6%;background:radial-gradient(ellipse at 75% 45%,#5b3dc27a,transparent 54%),linear-gradient(120deg,#14123d,#182052)}.hero small,.feature small,.text small{font-size:10px;color:#c8a4ff;letter-spacing:1.7px;font-weight:750}.hero h1{font-size:clamp(32px,5vw,61px);letter-spacing:-.05em;line-height:1.07;margin:19px 0}.hero p{max-width:460px;color:#bac5eb;font-size:14px;line-height:1.7}.cta{display:inline-block;border-radius:9px;color:#fff;font-size:12px;font-weight:650;background:linear-gradient(100deg,#9536fd,#415dff);padding:14px 17px;margin-top:14px}.sphere{width:min(29vw,225px);aspect-ratio:1;border-radius:50%;margin:auto;background:radial-gradient(circle at 31% 24%,#bdd8ff,#7b47fb 35%,#d845ef 67%,#0d0d3d 90%);box-shadow:0 0 62px #8956ffba,inset -15px -22px 29px #1e085f;border:2px solid #ab84ff;position:relative}.sphere:before,.sphere:after{content:'';position:absolute;inset:25% 8%;border:2px solid #a9eaff99;border-radius:50%;transform:rotate(23deg)}.sphere:after{transform:rotate(-30deg);inset:35% 6%;border-color:#eca4ff99}.feature{padding:64px 6%;background:linear-gradient(115deg,#111b48,#122b59)}.feature h2{font-size:clamp(28px,4vw,47px);letter-spacing:-.04em}.text{padding:40px 6%;border-top:1px solid #3a487d}.text p{font-size:20px;line-height:1.65}footer{padding:22px 6%;font-size:11px;color:#93a1c7}@media(max-width:600px){header{padding:14px 6%}nav{gap:9px;font-size:9px}nav span:last-child{display:none}.hero{grid-template-columns:1fr;min-height:590px;padding:36px 6%}.hero h1{font-size:clamp(30px,10vw,45px)}.hero p{font-size:12px}.sphere{width:175px}.feature{padding:42px 6%}}`;
 return '<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; style-src &#39;unsafe-inline&#39;; img-src data:; script-src &#39;none&#39;; base-uri &#39;none&#39;; form-action &#39;none&#39;"><title>'+title+'</title><style>'+styles+'</style></head><body><header><span class="logo"><i></i>'+title+'</span><nav><span>Ürün</span><span>Çözümler</span><span>Kaynaklar</span></nav></header><main>'+sections+'</main><footer>TASO Studio · Yerel HTML önizleme · Gerçek yayın değildir.</footer></body></html>';
}
