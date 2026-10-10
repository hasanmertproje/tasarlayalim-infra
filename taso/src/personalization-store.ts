import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const TASO_CONVERSATION_MODES = ['normal','work','stress','focus','casual'] as const;
export type TasoConversationMode = (typeof TASO_CONVERSATION_MODES)[number];
export const TASO_PROFANITY_POLICIES = ['never','mirror','allowed'] as const;
export type TasoProfanityPolicy = (typeof TASO_PROFANITY_POLICIES)[number];

export type TasoPersonality = {
  warmth: number;
  directness: number;
  humor: number;
  technicalDepth: number;
  verbosity: number;
  formality: number;
  slang: number;
  profanity: TasoProfanityPolicy;
};

export type UserPersonalization = {
  userId: string;
  preferredName?: string;
  about?: string;
  relationshipStyle?: string;
  mode: TasoConversationMode;
  personality: TasoPersonality;
  updatedAt: string;
};

export type CompanyIdentity = {
  companyName: string;
  creatorName: string;
  founderName: string;
  assistantOrigin: string;
  trustedFacts: string[];
  updatedAt: string;
};

type PersonalizationSnapshot = {
  version: 1;
  company: CompanyIdentity;
  defaults: TasoPersonality;
  users: Record<string, UserPersonalization>;
};

function isoNow(){ return new Date().toISOString(); }
function clamp(value: unknown, fallback: number){
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : fallback;
}
function defaultPersonality(): TasoPersonality {
  return { warmth: 56, directness: 82, humor: 34, technicalDepth: 78, verbosity: 42, formality: 34, slang: 24, profanity: 'mirror' };
}
function filePath(){ return process.env.TASO_PERSONALIZATION_FILE?.trim() || (process.env.NODE_ENV === 'production' ? '/data/taso-personalization.json' : undefined); }
function defaultCompany(): CompanyIdentity {
  return {
    companyName: 'Tasarlayalım',
    creatorName: 'Tasarlayalım ekibi',
    founderName: 'Hasan',
    assistantOrigin: 'Taso, Tasarlayalım ekibi tarafından geliştirilen genel amaçlı dijital asistan ve operasyon yardımcısıdır.',
    trustedFacts: ['Tasarlayalım’ın kurucusu Hasan’dır.'],
    updatedAt: isoNow(),
  };
}
function sanitizeText(value: unknown, max: number){ return typeof value === 'string' ? value.trim().slice(0,max) : undefined; }
function normalizePersonality(input: Partial<TasoPersonality> | undefined, base: TasoPersonality): TasoPersonality {
  const profanity = input?.profanity && TASO_PROFANITY_POLICIES.includes(input.profanity) ? input.profanity : base.profanity;
  return {
    warmth: clamp(input?.warmth, base.warmth), directness: clamp(input?.directness, base.directness), humor: clamp(input?.humor, base.humor),
    technicalDepth: clamp(input?.technicalDepth, base.technicalDepth), verbosity: clamp(input?.verbosity, base.verbosity), formality: clamp(input?.formality, base.formality),
    slang: clamp(input?.slang, base.slang), profanity,
  };
}

export class PersonalizationStore {
  private readonly path = filePath();
  private snapshot: PersonalizationSnapshot = this.load();

  getCompany(){ return JSON.parse(JSON.stringify(this.snapshot.company)) as CompanyIdentity; }
  getDefaults(){ return { ...this.snapshot.defaults }; }
  getUser(userId: string, fallbackName?: string): UserPersonalization {
    const existing = this.snapshot.users[userId];
    if (existing) return JSON.parse(JSON.stringify(existing)) as UserPersonalization;
    return { userId, preferredName: sanitizeText(fallbackName,80), mode:'normal', personality:{...this.snapshot.defaults}, updatedAt:isoNow() };
  }
  updateUser(userId: string, input: Partial<Omit<UserPersonalization,'userId'|'updatedAt'>>, fallbackName?: string){
    const current = this.getUser(userId, fallbackName);
    const next: UserPersonalization = {
      ...current,
      preferredName: input.preferredName === undefined ? current.preferredName : sanitizeText(input.preferredName,80),
      about: input.about === undefined ? current.about : sanitizeText(input.about,800),
      relationshipStyle: input.relationshipStyle === undefined ? current.relationshipStyle : sanitizeText(input.relationshipStyle,400),
      mode: input.mode && TASO_CONVERSATION_MODES.includes(input.mode) ? input.mode : current.mode,
      personality: normalizePersonality(input.personality, current.personality),
      updatedAt: isoNow(),
    };
    this.snapshot.users[userId] = next; this.persist(); return this.getUser(userId);
  }
  updateCompany(input: Partial<Omit<CompanyIdentity,'updatedAt'>>){
    const c = this.snapshot.company;
    if(input.companyName !== undefined) c.companyName = sanitizeText(input.companyName,80) || c.companyName;
    if(input.creatorName !== undefined) c.creatorName = sanitizeText(input.creatorName,120) || c.creatorName;
    if(input.founderName !== undefined) c.founderName = sanitizeText(input.founderName,120) || c.founderName;
    if(input.assistantOrigin !== undefined) c.assistantOrigin = sanitizeText(input.assistantOrigin,600) || c.assistantOrigin;
    if(Array.isArray(input.trustedFacts)) c.trustedFacts = [...new Set(input.trustedFacts.map(v=>sanitizeText(v,300)).filter((v):v is string=>Boolean(v)))].slice(0,50);
    c.updatedAt = isoNow(); this.persist(); return this.getCompany();
  }
  updateDefaults(input: Partial<TasoPersonality>){ this.snapshot.defaults = normalizePersonality(input,this.snapshot.defaults); this.persist(); return this.getDefaults(); }

  buildConversationContext(userId: string, fallbackName?: string){
    const user=this.getUser(userId,fallbackName); const company=this.getCompany();
    return { user, company, instructions: this.instructions(user,company) };
  }
  private instructions(user:UserPersonalization, company:CompanyIdentity){
    const p=user.personality;
    const modeRules:Record<TasoConversationMode,string>={
      normal:'Doğal, dengeli ve konuşma diline yakın ol.',
      work:'İş modundasın: sonuç, risk, uygulanabilirlik ve teknik doğruluk öncelikli; gereksiz sohbeti azalt.',
      stress:'Stres modundasın: çok kısa, sakin, kesin ve öncelik sıralı konuş; kullanıcının bilişsel yükünü artırma.',
      focus:'Odak modundasın: konu dışına çıkma, tek hedefe kilitlen, gerekli olmayan öneri üretme.',
      casual:'Gündelik moddasın: daha rahat ve doğal konuş; güvenlik ve doğruluk sınırlarını yine koru.',
    };
    const profanity = p.profanity==='allowed'
      ? 'Kullanıcı argo veya küfürlü konuşmayı tercih ediyorsa doğal bağlamda sınırlı argo/küfür kullanabilirsin; saldırganlık, hedef gösterme veya taciz üretme.'
      : p.profanity==='mirror'
        ? 'Kullanıcı argo/küfür kullanırsa tonu ölçülü biçimde aynalayabilirsin; durduk yere küfür başlatma.'
        : 'Argo/küfür kullanma.';
    return [
      `Konuşma modu: ${user.mode}. ${modeRules[user.mode]}`,
      `Kişilik ölçekleri 0-100: sıcaklık ${p.warmth}, direktlik ${p.directness}, mizah ${p.humor}, teknik derinlik ${p.technicalDepth}, cevap uzunluğu ${p.verbosity}, resmiyet ${p.formality}, argo ${p.slang}.`,
      profanity,
      user.preferredName ? `Kullanıcının tercih ettiği adı: ${user.preferredName}. Gerektiğinde doğal biçimde kullan; her cevapta tekrar etme.` : '',
      user.about ? `Kullanıcı hakkında güvenilir profil notu: ${user.about}` : '',
      user.relationshipStyle ? `İlişki/iletişim tercihi: ${user.relationshipStyle}` : '',
      `Şirket kimliği: ${company.companyName}. Taso'yu geliştiren: ${company.creatorName}. Kurucu: ${company.founderName}.`,
      `Taso köken açıklaması: ${company.assistantOrigin}`,
      company.trustedFacts.length ? `Güvenilir şirket gerçekleri: ${company.trustedFacts.join(' | ')}` : '',
      'Kendinden bahsederken sürekli workspace veya operasyon asistanı kalıbını tekrarlama. Sorunun bağlamına göre doğal konuş.',
    ].filter(Boolean).join('\n');
  }
  private load():PersonalizationSnapshot{
    const fallback:PersonalizationSnapshot={version:1,company:defaultCompany(),defaults:defaultPersonality(),users:{}};
    if(!this.path) return fallback;
    try{
      const parsed=JSON.parse(readFileSync(this.path,'utf8')) as Partial<PersonalizationSnapshot>;
      return { version:1, company:{...fallback.company,...(parsed.company??{}),trustedFacts:Array.isArray(parsed.company?.trustedFacts)?parsed.company!.trustedFacts.slice(0,50):fallback.company.trustedFacts}, defaults:normalizePersonality(parsed.defaults,fallback.defaults), users:parsed.users&&typeof parsed.users==='object'?parsed.users:{} };
    }catch(error){ if((error as NodeJS.ErrnoException).code==='ENOENT') return fallback; throw new Error(`Taso personalization state could not be loaded: ${(error as Error).message}`); }
  }
  private persist(){ if(!this.path)return; mkdirSync(dirname(this.path),{recursive:true,mode:0o700}); const tmp=`${this.path}.${process.pid}.tmp`; writeFileSync(tmp,`${JSON.stringify(this.snapshot,null,2)}\n`,{encoding:'utf8',mode:0o600}); renameSync(tmp,this.path); }
}
