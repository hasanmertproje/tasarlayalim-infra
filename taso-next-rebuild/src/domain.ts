export type Area='admin'|'workspace';
export type Status='queued'|'running'|'review'|'approved'|'rejected'|'done';
export interface Project {id:string;name:string;code:string;description:string;progress:number;stage:'active'|'review'|'paused';owner:string}
export interface Task {id:string;projectId:string;title:string;agent:string;status:Status;priority:'normal'|'high';created:number}
export interface Approval {id:string;taskId:string;projectId:string;note:string;decision:'pending'|'approved'|'rejected';reason:string}
export interface Event {id:string;at:number;message:string;type:string}
export interface StudioBlock{id:string;type:'hero'|'text'|'feature';label:string;value:string}
import type {SavedRevision} from './PublisherStudio';
export interface WorkspaceData{publisherVersions:SavedRevision[];studioDocuments:Record<string,StudioBlock[]>;projects:Project[];tasks:Task[];approvals:Approval[];events:Event[];blocks:StudioBlock[];notices:{id:string;title:string;read:boolean}[];issues:{id:string;title:string;severity:'critical'|'warning'|'info';resolved:boolean}[];releases:{id:string;label:string;environment:'draft'|'preview'|'production';at:number}[];messages:{role:'user'|'assistant';text:string}[];team:{id:string;name:string;role:string}[];settings:{sound:boolean;reducedMotion:boolean};}
export const ADMIN_GROUPS = [
  {label:'KOMUTA',items:['Genel Bakış','Komuta Merkezi','Görevler','Projeler','Onaylar']},
  {label:'YÜRÜTME',items:['Ajanlar','İzleme','Altyapı','Dağıtımlar','Bilgi Merkezi']},
  {label:'YÖNETİM',items:['Entegrasyonlar','Bildirimler','Kullanıcılar','Roller','Güvenlik','Sistem Ayarları']},
  {label:'ÜRETİM',items:['Studio','Yayıncı','Voice']}
] as const;
export const WORKSPACE_GROUPS = [
  {label:'ÇALIŞMA ALANIM',items:['Ana Sayfa','Projelerim','Atamalar','İş Birliği','Studio','Canlı Site Editörü']},
  {label:'İÇERİK',items:['Dosyalar','İçerik','Ajanlarım','Konuşmalar','Yayınlar']},
  {label:'HESAP',items:['Ekip','Bildirimler','Ayarlar','Kişiselleştirme','Voice']}
] as const;
export const INITIAL:WorkspaceData = {
 publisherVersions:[],studioDocuments:{},
 projects:[
  {id:'pr-1',name:'TASO NEXT',code:'TAS',description:'Otonom üretim ve operasyon deneyimi',progress:68,stage:'active',owner:'Ürün ekibi'},
  {id:'pr-2',name:'EntegrePilot',code:'ENT',description:'Çok kanallı ticaret operasyonları',progress:42,stage:'review',owner:'Commerce'},
  {id:'pr-3',name:'Tasarlayalım Menü',code:'MNU',description:'QR menü ve işletme yönetimi',progress:83,stage:'active',owner:'Platform'},
 ],
 tasks:[
  {id:'ts-1',projectId:'pr-1',title:'Operasyon ekranlarının veri akışını doğrula',agent:'NEXUS',status:'running',priority:'high',created:1},
  {id:'ts-2',projectId:'pr-1',title:'Mobil stüdyo sürümünü incele',agent:'FORGE',status:'review',priority:'normal',created:2},
  {id:'ts-3',projectId:'pr-2',title:'Commerce stok doğrulamasını tamamla',agent:'CORTEX',status:'queued',priority:'normal',created:3},
 ],
 approvals:[{id:'ap-1',taskId:'ts-2',projectId:'pr-1',note:'Mobil stüdyo değişiklikleri üretime alınmadan önce gözden geçirilmeli.',decision:'pending',reason:''}],
 events:[{id:'ev-1',at:3,message:'Mobil stüdyo görevi incelemeye gönderildi',type:'review'},{id:'ev-2',at:2,message:'NEXUS operasyon testi başladı',type:'task'},{id:'ev-3',at:1,message:'Çalışma alanı açıldı',type:'system'}],
 blocks:[{id:'bl-1',type:'hero',label:'Başlık',value:'Bir fikri birlikte hayata geçirelim.'},{id:'bl-2',type:'text',label:'Açıklama',value:'TASO ile tasarla, yönet ve güvenle yayınla.'},{id:'bl-3',type:'feature',label:'Öne çıkan',value:'Tek bir merkezden üretim ve kontrol'}],
 notices:[{id:'n-1',title:'Stüdyo onayı bekleniyor',read:false},{id:'n-2',title:'TASO NEXT kontrol listesi güncellendi',read:false},{id:'n-3',title:'EntegrePilot kaynakları senkronize edildi (örnek)',read:true}],
 issues:[{id:'is-1',title:'Preview doğrulaması bekliyor (örnek)',severity:'warning',resolved:false},{id:'is-2',title:'İş kuyruğunda gecikme (örnek)',severity:'critical',resolved:false},{id:'is-3',title:'Son yedek doğrulaması (örnek)',severity:'info',resolved:true}],
 releases:[{id:'rel-1',label:'TASO NEXT • 0.7 demo taslak',environment:'draft',at:1}],
 messages:[{role:'assistant',text:'TASO NEXT tasarım laboratuvarına hoş geldin. Bu konuşma çevrimdışı örnek veridir; gerçek model bağlantısı yok.'}],
 team:[{id:'tm-1',name:'Platform ekibi',role:'Yönetici'},{id:'tm-2',name:'Tasarım ekibi',role:'Editör'}],
 settings:{sound:false,reducedMotion:false}
};
export function loadData():WorkspaceData{try{const raw=localStorage.getItem('taso-next-rebuild-v1');if(raw){const v=JSON.parse(raw);if(v&&Array.isArray(v.projects)&&Array.isArray(v.tasks)&&Array.isArray(v.approvals))return {...INITIAL,...v,publisherVersions:Array.isArray(v.publisherVersions)?v.publisherVersions:[],studioDocuments:v.studioDocuments&&typeof v.studioDocuments==='object'&&!Array.isArray(v.studioDocuments)?v.studioDocuments:{}};}}catch{}return JSON.parse(JSON.stringify(INITIAL));}
export function saveData(data:WorkspaceData){try{localStorage.setItem('taso-next-rebuild-v1',JSON.stringify(data));}catch{}}
export function projectBlocks(data:WorkspaceData,id:string):StudioBlock[]{const existing=data.studioDocuments?.[id];if(Array.isArray(existing)&&existing.length)return existing;if(id==='pr-1')return data.blocks;const name=data.projects.find(p=>p.id===id)?.name||'Yeni proje';return [{id:'hero-'+id,type:'hero',label:'Başlık',value:name+' ile yeni fikirler'},{id:'body-'+id,type:'text',label:'Açıklama',value:'Bu projeye ait yerel Studio belgesi.'}];}
