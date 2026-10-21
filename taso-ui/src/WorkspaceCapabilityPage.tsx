import { useMemo } from 'react';
import { navigateTaso } from './navigation';
import type { TasoScreen } from './navigation';

type Capability = {
  eyebrow: string;
  title: string;
  description: string;
  reason: string;
  supported: string[];
  next: Array<{ label: string; target: TasoScreen }>;
};

const CAPABILITIES: Partial<Record<TasoScreen, Capability>> = {
  'Live Site Editor': {
    eyebrow: 'YAYIN GÜVENLİĞİ',
    title: 'Canlı Site Editörü henüz etkin değil',
    description: 'TASO Studio tasarım belgesi düzenleyebilir; ancak bu tek başına bir siteyi canlı ortamda düzenlemek veya yayınlamak anlamına gelmez.',
    reason: 'Bu alan, proje dosya sistemi + izole build/preview + artifact doğrulaması + ayrı yayın onayı uçtan uca doğrulanana kadar kapalı tutuluyor.',
    supported: ['TASO Studio içinde projeye bağlı tasarım belgesi', 'Mevcut görev ve dağıtım ekranlarında gerçek Core durumu'],
    next: [{ label: 'Tasarım Stüdyosunu aç', target: 'Workspace Studio' }, { label: 'Yayın durumlarını görüntüle', target: 'Publications' }],
  },
  'Code & Files': {
    eyebrow: 'PROJE DOSYALARI',
    title: 'Dosya çalışma alanı henüz etkin değil',
    description: 'Bu alanı güvenli biçimde açmak için dosya okuma/yazma işlemlerinin proje kapsamı, izin kontrolü ve denetim iziyle doğrulanması gerekiyor.',
    reason: 'Şimdilik bu ekran gerçek dosya editörü veya GitHub yazma yeteneği varmış gibi davranmaz.',
    supported: ['Proje deposu ve manifest bilgileri', 'Mevcut görev akışında kontrollü kod değişikliği ve PR takibi'],
    next: [{ label: 'Projelerimi aç', target: 'My Projects' }, { label: 'Görev geçmişini aç', target: 'Task History' }],
  },
  Team: {
    eyebrow: 'EKİP VE İŞ BİRLİĞİ',
    title: 'Ekip yönetimi henüz etkin değil',
    description: 'Arayüzde bir ekip listesi göstermek, gerçek çok kullanıcılı iş birliği veya rol güvenliği sağlamaz.',
    reason: 'Üye daveti, organizasyon üyeliği ve proje izinleri sunucu tarafında doğrulanana kadar ekip yönetimi devre dışıdır.',
    supported: ['Mevcut oturum ve Core izin sınırları', 'Projeler, görevler ve onaylar için mevcut erişim denetimleri'],
    next: [{ label: 'Projelerimi aç', target: 'My Projects' }, { label: 'Hesap ayarlarına dön', target: 'Account Settings' }],
  },
  Personalization: {
    eyebrow: 'KİŞİSELLEŞTİRME',
    title: 'Kişisel tercih merkezi henüz etkin değil',
    description: 'Tema değişimi üst çubuktan kullanılabilir. Diğer kişisel tercihler için kalıcı ve kullanıcıya bağlı bir API henüz bu ekrana bağlanmış değil.',
    reason: 'Bu ekran kalıcı ayarları kaydediyormuş gibi sahte bir form sunmaz.',
    supported: ['Üst çubuktan açık/koyu tema', 'Mobil ve masaüstü için uyumlu gezinme'],
    next: [{ label: 'Ana sayfaya dön', target: 'Workspace' }, { label: 'Hesap ayarları', target: 'Account Settings' }],
  },
  'Account Settings': {
    eyebrow: 'HESAP GÜVENLİĞİ',
    title: 'Hesap ayarları henüz ayrı bir alan değil',
    description: 'Mevcut yönetim ayarları kişisel hesap ayarlarıyla aynı şey değildir. Bu ekran yönetim kontrollerini kullanıcı hesabı ayarı gibi göstermeyecek.',
    reason: 'Kişisel profil, parola, oturumlar ve TOTP işlemleri için ayrı ve doğrulanmış Core sözleşmesi gerekir.',
    supported: ['Mevcut oturum doğrulaması ve güvenli çıkış', 'Yönetim tarafındaki mevcut ayarlar ayrı tutulur'],
    next: [{ label: 'Ana sayfaya dön', target: 'Workspace' }, { label: 'Bildirimler', target: 'Workspace Notifications' }],
  },
  Infrastructure: {
    eyebrow: 'ALTYAPI GÖRÜNÜRLÜĞÜ',
    title: 'Altyapı ayrıntıları doğrulanmış bir sayfaya taşınıyor',
    description: 'Sadece bir menü öğesi görünmesi, altyapı envanterinin ve servis durumlarının bu ekranda eksiksiz gösterildiği anlamına gelmez.',
    reason: 'Doğrulanmış Core ve dağıtım sinyalleri mevcut İzleme ve Dağıtımlar ekranlarından görülebilir; eksik telemetry burada uydurulmaz.',
    supported: ['Core sağlık durumu ve executor yetenekleri', 'Mevcut dağıtım kayıtları ve onay kapıları'],
    next: [{ label: 'İzlemeyi aç', target: 'Monitoring' }, { label: 'Dağıtımları aç', target: 'Deployments' }],
  },
};

export default function WorkspaceCapabilityPage({ screen }: { screen: TasoScreen }) {
  const capability = useMemo(() => CAPABILITIES[screen], [screen]);
  if (!capability) return null;
  return (
    <section className="tn-capability" aria-labelledby="tn-capability-title">
      <div className="tn-capability__eyebrow">{capability.eyebrow}</div>
      <div className="tn-capability__layout">
        <div className="tn-capability__main">
          <div className="tn-capability__status"><span aria-hidden="true" /> Güvenli erişim sınırı</div>
          <h2 id="tn-capability-title">{capability.title}</h2>
          <p className="tn-capability__description">{capability.description}</p>
          <div className="tn-capability__reason"><strong>Neden kapalı?</strong><p>{capability.reason}</p></div>
          <div className="tn-capability__actions">
            {capability.next.map(action => <button key={action.target} type="button" onClick={() => navigateTaso(action.target)}>{action.label}<span aria-hidden="true">↗</span></button>)}
          </div>
        </div>
        <aside className="tn-capability__side">
          <span>ŞU ANDA KULLANILABİLENLER</span>
          <ul>{capability.supported.map(item => <li key={item}>{item}</li>)}</ul>
          <small>Bu alan gerçek bir yetenek olarak kabul edilmeden önce API, yetki ve uçtan uca kabul testlerinden geçmelidir.</small>
        </aside>
      </div>
    </section>
  );
}
