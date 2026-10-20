# TASO NEXT — kaynak karşılaştırması ve entegrasyon matrisi (2026-10-20)

**Girdi:** Kullanıcının `TASO-NEXT-React-TypeScript-Kaynak.zip` arşivindeki `README.md`, `QA.md`, `SCREEN_MAP.md`, `src/{app,model,studio,ui,views}.tsx`, `test-results/` ve 6 referans görüntü. Bu belge prototipin test sonuçlarını production kabul testi olarak sunmaz.

**Canlı repo:** `hasanmertproje/tasarlayalim-infra`, `taso-ui/` (React/Vite/TypeScript), `taso/` (Core). Kullanılan taban sürüm `abdfe9f2`. Production başlangıç sürümü `506a1a7d`. Normal production yedekleme kapıları aktif; hiçbir production rollout talep edilmedi.

## Kaynak gerçeği ve koruma sınırları

Prototip: React 16 UMD, çevrimdışı HTML, proje/mission/onay/rol/sayfa/version için tek `PrototypeData` localStorage deposu, kurallı/deterministik sohbet, sentetik görev adımları, şekil/section temelli Studio; gerçek STT/TTS, API, TOTP, backend RBAC, uçtan uca yayınlama ve framework build yok. Prototip QA: 320–1920 ilk görünüm render; 390/1440 20/20 yerel flow; 390 12/12 demo interaksiyon. Bunlar gerçek Core kabul kanıtı değildir.

Canlı: `AuthGateV17` oturum + TOTP; `nginx.conf` gateway ve `auth_request`; `CommandCenterV30` Core veri kaynağı ve görev oluşturma; `ProjectCenterV9` proje/manifest/lifecycle; `MissionControlV8` yürütme; `ApprovalCenterV9` korunan onay; `DashboardChat` proje bazlı konuşma/Voice; `VoiceModeOverlay`; Agents/Knowledge/Integrations/Monitoring gerçek veya truth-labeled yüzeyler. Yeni tasarım bu modülleri kaldırmamalı.

## Entegrasyon matrisi

| TASO NEXT alanı | Prototip mekanizması | Gerçek TASO dayanağı | Milestone 1 sonucu / açık kapı |
|---|---|---|---|
| Premium admin dashboard | Statik örnek kartlar, sayısal simülasyon | `CommandCenterV30` Core projeler, missions, agents, capabilities, Voice | **Tasarım temel katmanı uygulandı**; gerçek API ve CTA korundu, görünüm referansına yaklaştırıldı |
| Mobil admin | Görsel sekme ve yerel kartlar | `DashboardShellV2` mobile dock / drawer | **Yeni spektrum ve responsive katman**; mevcut mic/Voice ve navigasyon korunur |
| Kullanıcı Workspace | Demo role-switch ve `PrototypeData` | `AuthGateV17`, `/v1/projects`, `/v1/missions`, `/v1/operations` | **Yeni gerçek veri ekranı:** otomatik veri yenileme, hata/boş durumları, nav; backend kullanıcı RBAC **henüz yok** |
| Mobil kullanıcı | Demo 390 px kurgusu | Yeni `NextWorkspace` + mevcut mobile shell | 320–1920 Chromium kabul testi eklendi; gerçek cihaz henüz yok |
| Tasarım Stüdyosu | Local section-tree + undo/redo | Project manifest + Knowledge + GitHub görev motoru | **Yapılmadı**; önce kalıcı belge modeli, erişim politikası ve editör araştırması |
| Canlı Site Editörü | Sahte dosya listesi, farklı framework şablon etiketleri, statik HTML export | Manifest ve GitHub broker; preview/deploy lane | **Yapılmadı**; framework üretimi/build/preview/doğrulama gerekli |
| TASO ile Beraber Yapalım | Deterministik local cevap | `DashboardChat` + Core conversations/missions | Milestone 1'de mevcut gerçek sohbet/mission girişine bağlanır; ayrı workspace ve dosya senkronizasyonu henüz yok |
| AI Copilot | Local rule matching | Core AI + policy/mission approval | **Yapılmadı**; güvenli öneri → diff → onay → kayıt akışı gerekli |
| Voice orb | Sadece CSS animasyonu | Tarayıcı STT/TTS ve Core Voice endpoint'leri | **Yalnızca dekoratif yeni orb**; çalışır mikrofon akışı mevcut `DashboardChat` içinde kalır |
| Roller / Admin–Kullanıcı | İstemci tarafında güvenliksiz role picker | Mevcut owner AuthGate, Core auth | **Yetki değiştiren toggle eklenmedi**; yönetim/Workspace navigasyonu mevcut oturum içindedir. Ayrı kullanıcı hesabı/organizasyon RBAC server-side kontratı gerekir |
| Sağlık / istatistik | Sentetik 99,8% uptime / sahte örnek veri | Core health + operations | **Sahte sayılar yasak**; yalnızca Core verisi veya `—` ve net hata |
| Proje teknolojisi | Laravel/CI4/Next vb etiket + örnek kod | Core project manifest + görev motoru | **Gerçek framework desteği eklenmedi**; template ve sandbox kabul testleri gerekli |

## Milestone 1 dosyaları

- `taso-ui/src/NextOrb.tsx`: tek dekoratif, kullanıcı etkileşimini ve sağlık iddiasını taklit etmeyen orb.
- `taso-ui/src/NextWorkspace.tsx`: doğrulanmış AuthGate altında gerçek Core verisiyle kullanıcı çalışma alanı kompozisyonu; no mock data.
- `taso-ui/src/taso-next-foundation.css`: premium ürün dili, sadece shell/CommandCenter/Workspace kapsamlı görsel katman; reduced-motion; 320 px güvenliği.
- `taso-ui/src/{navigation.ts,main.tsx,DashboardShellV2.tsx,CommandCenterV30.tsx}`: geriye uyumlu ekran ekleme; mevcut mutation flows ve Voice bileşenleri korunur.
- `scripts/taso-visual-acceptance.mjs`: gerçek isolated Core ile 320, 360, 390, 430, 768, 1024, 1440, 1920 Chromium çekimleri, Core veri ve gezinme assertions.

## Güvenlik durumu

- Workspace, mevcut authenticated operator hesabının **alternatif ürün yüzeyidir**; sunucu tarafında ayrı kullanıcı rolü veya yetki devri **değildir**. API istekleri tarayıcının var olan `same-origin` auth/cookie sınırını kullanır. Şifre, gateway, TOTP, Coolify, volume veya mevcut Core route değişmez.
- `/v1/missions` yazma işlemleri mevcut CommandCenter yolunda ve mevcut onay/görev politikalarında kalır. Yeni Workspace doğrudan görev oluşturmaz; yetki sınırını client role switch ile taklit etmez.
- **Preview/staging:** mevcut `Taso Urgent Preview` PR tetikleyicisi; CI başarı + yalnızca preview kabulü. Production rollout bu PR kapsamında yasak.
- **Rollback:** PR merge edilmediği sürece `main` ve production değişmez. Canlı geçiş öncesi üretim sürümünü/disk yedeğini ve geri dönüşü ayrıca doğrula; s3 hedefi yapılandırılmadı.

## Milestone 2 tasarım kararı öncesi

1. Studio editör adayları için (örn. GrapesJS, Craft.js, Lexical/Tiptap + custom scene, Fabric/Konva) MIT/ilgili lisans, bundle boyutu, controlled schema, React sürüm uyumu, undo/redo ve mobil pointer interaction araştırması **yapılacak**; bu belge seçim kararı değildir.
2. Core'da `StudioDocument` / `Page` / `Node` / `Revision` kalıcılığı, project membership, optimistic locking ve audit trail tasarlanacak. Prototip `localStorage` verileri üretim kaynağı olarak kullanılmayacak.
3. Studio/Publisher kod/önizleme bütünlüğü: AST/derleme motoru, framework fixture testleri, isolated worker build, artifact registry, preview namespace ve izinli release kapıları.
4. Farklı kullanıcı/organizasyon rolleri: backend kimlik modeli ve sunucu-enforced permission matrix; UI sadece response capability üzerinden koşullu render.
5. Beraber Yapalım: mevcut konuşma/mission store'dan Studio belge değişikliği taslağı; diff ve insan onayı olmadan yazma yok.

## Açık kabul kriterleri

- Browser CI'daki gerçek Chromium şahitliği ve Vite TS build başarılı olmadan PR tamamlanmış sayılmaz.
- Mobil 320–1920 overflow/z-index ve dock testi.
- Yeni Workspace sayılarını Core'dan gelen gerçek `projects` ile karşılaştıran otomasyon.
- Admin login/TOTP + gerçek görev/approval + voice regression mevcut testleri yeşil kalmalı.
- “Admin/kullanıcı server-side ayrımı” ve “Studio/Pubisher production” **milestone 1 sonucu değildir**.
