import { FormEvent, useEffect, useMemo, useState } from 'react';
import { navigateTaso } from './navigation';

type Project = {
  id: string;
  slug: string;
  name: string;
  repository: string;
  isExisting: boolean;
  defaultBranch?: string;
  technology?: {
    stackMode?: string;
    architecture?: string;
    preferred?: string[];
    forbidden?: string[];
  };
  createdAt?: string;
};

type Mission = {
  id: string;
  projectId: string;
  objective: string;
  status: string;
  riskLevel?: string;
  updatedAt?: string;
  execution?: {
    progressPercent?: number;
    currentAction?: string;
    commitSha?: string;
    previewUrl?: string;
    pullRequestUrl?: string;
    intentProfile?: { mode?: string; requiredSpecialists?: string[]; skillHints?: string[] };
  };
};

type Manifest = {
  source: string;
  appType?: string;
  languages: string[];
  frameworks: string[];
  architecture?: string;
  packageManagers: string[];
  databases: string[];
  protectedPaths: string[];
  constraints: string[];
  confidence: number;
  updatedAt: string;
};

type KnowledgeRecord = {
  id: string;
  kind: string;
  title: string;
  body: string;
  tags: string[];
  source: string;
  updatedAt: string;
};

type Milestone = {
  id: string;
  title: string;
  status: string;
  progress?: number;
  weight?: number;
};

type MilestoneProgress = {
  configured: boolean;
  percent: number | null;
  total: number;
  completed: number;
  blocked: number;
  active: number;
  cancelled: number;
  totalWeight: number;
};

type MilestonePayload = { milestones: Milestone[]; progress: MilestoneProgress };

const EMPTY_MILESTONE_PROGRESS: MilestoneProgress = {
  configured: false,
  percent: null,
  total: 0,
  completed: 0,
  blocked: 0,
  active: 0,
  cancelled: 0,
  totalWeight: 0,
};

const API_URL = ((import.meta.env.VITE_TASO_API_URL as string | undefined) || '/api').replace(/\/$/, '');
const activeStates = new Set(['queued', 'planning', 'running', 'testing', 'waiting_approval']);

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const payload = await response.json();
      if (payload?.error) message = payload.error;
    } catch { /* keep HTTP error */ }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

function relative(value?: string) {
  if (!value) return '—';
  const delta = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(delta)) return value;
  const minutes = Math.max(0, Math.floor(delta / 60_000));
  if (minutes < 1) return 'az önce';
  if (minutes < 60) return `${minutes}dk önce`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}sa önce`;
  return new Date(value).toLocaleDateString('tr-TR');
}

function stateLabel(value?: string) {
  const labels: Record<string, string> = {
    queued: 'Kuyrukta', planning: 'Planlanıyor', running: 'Çalışıyor', testing: 'Doğrulanıyor',
    waiting_approval: 'Onay bekliyor', preview_ready: 'Preview hazır', completed: 'Tamamlandı', failed: 'Hata', cancelled: 'İptal',
    planned: 'Planlandı', in_progress: 'Devam ediyor', done: 'Tamamlandı', blocked: 'Bloke',
  };
  return value ? labels[value] ?? value : '—';
}

export default function ProjectCenterV9() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [knowledge, setKnowledge] = useState<KnowledgeRecord[]>([]);
  const [milestones, setMilestones] = useState<MilestonePayload>({ milestones: [], progress: EMPTY_MILESTONE_PROGRESS });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [draft, setDraft] = useState({ name: '', slug: '', repository: '', isExisting: true });

  async function refreshBase() {
    try {
      const [projectPayload, missionPayload] = await Promise.all([
        requestJson<{ projects: Project[] }>('/v1/projects'),
        requestJson<{ missions: Mission[] }>('/v1/missions'),
      ]);
      const nextProjects = projectPayload.projects ?? [];
      setProjects(nextProjects);
      setMissions(missionPayload.missions ?? []);
      setSelectedId((current) => current && nextProjects.some((project) => project.id === current)
        ? current
        : nextProjects[0]?.id ?? '');
      setError('');
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  async function refreshProject(projectId: string) {
    if (!projectId) return;
    const [manifestResult, knowledgeResult, milestoneResult] = await Promise.allSettled([
      requestJson<{ manifest: Manifest }>(`/v1/projects/${projectId}/manifest`),
      requestJson<{ knowledge: KnowledgeRecord[] }>(`/v1/projects/${projectId}/knowledge`),
      requestJson<MilestonePayload>(`/v1/projects/${projectId}/milestones`),
    ]);
    setManifest(manifestResult.status === 'fulfilled' ? manifestResult.value.manifest : null);
    setKnowledge(knowledgeResult.status === 'fulfilled' ? knowledgeResult.value.knowledge ?? [] : []);
    setMilestones(milestoneResult.status === 'fulfilled'
      ? milestoneResult.value
      : { milestones: [], progress: EMPTY_MILESTONE_PROGRESS });
  }

  useEffect(() => {
    void refreshBase();
    const timer = window.setInterval(() => { if (!document.hidden) void refreshBase(); }, 6000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => { void refreshProject(selectedId); }, [selectedId]);

  const selected = useMemo(() => projects.find((project) => project.id === selectedId) ?? projects[0], [projects, selectedId]);
  const projectMissions = useMemo(() => missions.filter((mission) => mission.projectId === selected?.id), [missions, selected?.id]);
  const activeMission = projectMissions.find((mission) => activeStates.has(mission.status));
  const recentMissions = [...projectMissions].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')).slice(0, 6);

  function openMission(missionId: string) {
    window.dispatchEvent(new CustomEvent('taso:open-mission', { detail: { missionId } }));
  }

  async function createProject(event: FormEvent) {
    event.preventDefault();
    if (!draft.name.trim() || !draft.slug.trim() || !draft.repository.trim()) return;
    setBusy(true);
    try {
      const payload = await requestJson<{ project: Project }>('/v1/projects', {
        method: 'POST',
        body: JSON.stringify({
          name: draft.name.trim(),
          slug: draft.slug.trim().toLowerCase().replace(/\s+/g, '-'),
          repository: draft.repository.trim(),
          isExisting: draft.isExisting,
        }),
      });
      setDraft({ name: '', slug: '', repository: '', isExisting: true });
      setShowCreate(false);
      await refreshBase();
      setSelectedId(payload.project.id);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="pc9-shell" aria-label="Projects">
      <header className="pc9-topbar">
        <div><span className="pc9-kicker">PROJECT OPERATIONS</span><h1>Projeler</h1><p>Repo, bağlam, mission ve teslim zinciri tek yerde.</p></div>
        <button type="button" className="pc9-primary" onClick={() => setShowCreate((value) => !value)}>+ Yeni proje</button>
      </header>

      {error && <div className="pc9-alert">{error}</div>}

      {showCreate && (
        <form className="pc9-create" onSubmit={createProject}>
          <div><label>Proje adı</label><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Örn. Acme Agency" /></div>
          <div><label>Slug</label><input value={draft.slug} onChange={(event) => setDraft({ ...draft, slug: event.target.value })} placeholder="acme-agency" /></div>
          <div className="wide"><label>GitHub repository</label><input value={draft.repository} onChange={(event) => setDraft({ ...draft, repository: event.target.value })} placeholder="owner/repository" /></div>
          <label className="pc9-check"><input type="checkbox" checked={draft.isExisting} onChange={(event) => setDraft({ ...draft, isExisting: event.target.checked })} /> Mevcut proje</label>
          <button disabled={busy} type="submit">{busy ? 'Oluşturuluyor…' : 'Workspace oluştur'}</button>
        </form>
      )}

      <div className="pc9-layout">
        <aside className="pc9-project-list">
          <div className="pc9-list-head"><span>WORKSPACES</span><strong>{projects.length}</strong></div>
          <div className="pc9-list-scroll">
            {projects.map((project) => {
              const missionsForProject = missions.filter((mission) => mission.projectId === project.id);
              const active = missionsForProject.find((mission) => activeStates.has(mission.status));
              return (
                <button key={project.id} type="button" className={project.id === selected?.id ? 'active' : ''} onClick={() => setSelectedId(project.id)}>
                  <i className={active ? `state-${active.status}` : 'state-idle'} />
                  <div><strong>{project.name}</strong><small>{project.repository}</small></div>
                  <span>{active ? stateLabel(active.status) : 'Hazır'}</span>
                </button>
              );
            })}
            {!projects.length && <div className="pc9-empty">Henüz proje yok.</div>}
          </div>
        </aside>

        <main className="pc9-main">
          {!selected ? <div className="pc9-empty large">Bir workspace oluşturulduğunda proje bağlamı burada görünecek.</div> : <>
            <section className="pc9-hero">
              <div className="pc9-title-row">
                <div><span>{selected.slug}</span><h2>{selected.name}</h2><p>{selected.repository} · {selected.isExisting ? 'mevcut proje' : 'yeni proje'}</p></div>
                <div className="pc9-actions">
                  <button type="button" onClick={() => navigateTaso('Knowledge')}>Knowledge</button>
                  {activeMission && <button type="button" className="accent" onClick={() => openMission(activeMission.id)}>Mission Control</button>}
                </div>
              </div>
              <div className="pc9-status-strip">
                <div><span>AKTİF MISSION</span><strong>{activeMission ? stateLabel(activeMission.status) : 'Yok'}</strong></div>
                <div><span>MISSION SAYISI</span><strong>{projectMissions.length}</strong></div>
                <div><span>KNOWLEDGE</span><strong>{knowledge.length}</strong></div>
                <div><span>MILESTONE</span><strong>{!milestones.progress.configured || milestones.progress.percent === null ? 'Yapılandırılmadı' : `%${milestones.progress.percent}`}</strong></div>
                <div><span>MANIFEST</span><strong>{manifest ? `%${Math.round(manifest.confidence * 100)} güven` : 'Yok'}</strong></div>
              </div>
            </section>

            <div className="pc9-grid">
              <section className="pc9-surface pc9-active">
                <div className="pc9-section-head"><div><span>ACTIVE MISSION</span><strong>{activeMission ? activeMission.objective : 'Aktif iş yok'}</strong></div></div>
                {activeMission ? <>
                  <div className="pc9-mission-progress"><i style={{ width: `${Math.max(0, Math.min(100, activeMission.execution?.progressPercent ?? 0))}%` }} /></div>
                  <p>{activeMission.execution?.currentAction ?? stateLabel(activeMission.status)}</p>
                  <div className="pc9-chips">
                    <span>{stateLabel(activeMission.status)}</span>
                    <span>{activeMission.riskLevel ?? '—'}</span>
                    {activeMission.execution?.intentProfile?.mode && <span>{activeMission.execution.intentProfile.mode}</span>}
                  </div>
                  <button type="button" className="pc9-link" onClick={() => openMission(activeMission.id)}>Yürütmeyi aç →</button>
                </> : <div className="pc9-empty compact">Bu proje için çalışan mission yok.</div>}
              </section>

              <section className="pc9-surface">
                <div className="pc9-section-head"><div><span>PROJECT MANIFEST</span><strong>Gerçek teknoloji bağlamı</strong></div><small>{manifest ? relative(manifest.updatedAt) : 'manifest yok'}</small></div>
                {manifest ? <div className="pc9-manifest">
                  <div><span>Uygulama</span><strong>{manifest.appType ?? '—'}</strong></div>
                  <div><span>Mimari</span><strong>{manifest.architecture ?? selected.technology?.architecture ?? '—'}</strong></div>
                  <div><span>Diller</span><strong>{manifest.languages.join(', ') || '—'}</strong></div>
                  <div><span>Framework</span><strong>{manifest.frameworks.join(', ') || '—'}</strong></div>
                  <div><span>Veritabanı</span><strong>{manifest.databases.join(', ') || '—'}</strong></div>
                  <div><span>Korunan path</span><strong>{manifest.protectedPaths.length}</strong></div>
                </div> : <div className="pc9-empty compact">Bu proje için manifest henüz keşfedilmemiş.</div>}
              </section>

              <section className="pc9-surface">
                <div className="pc9-section-head"><div><span>PROJECT KNOWLEDGE</span><strong>Son bağlam kayıtları</strong></div><small>{knowledge.length} kayıt</small></div>
                <div className="pc9-knowledge-list">
                  {knowledge.slice(0, 5).map((record) => <article key={record.id}><span>{record.kind} · {record.source}</span><strong>{record.title}</strong><p>{record.body.slice(0, 180)}{record.body.length > 180 ? '…' : ''}</p>{record.tags.length > 0 && <small>{record.tags.join(' · ')}</small>}</article>)}
                  {!knowledge.length && <div className="pc9-empty compact">Project knowledge kaydı yok.</div>}
                </div>
              </section>

              <section className="pc9-surface">
                <div className="pc9-section-head"><div><span>RECENT MISSIONS</span><strong>İş geçmişi</strong></div><small>{projectMissions.length} toplam</small></div>
                <div className="pc9-mission-list">
                  {recentMissions.map((mission) => <button type="button" key={mission.id} onClick={() => openMission(mission.id)}><i className={`state-${mission.status}`} /><div><strong>{mission.objective}</strong><small>{stateLabel(mission.status)} · {relative(mission.updatedAt)}</small></div><span>{mission.execution?.commitSha?.slice(0, 8) ?? '—'}</span></button>)}
                  {!recentMissions.length && <div className="pc9-empty compact">Mission geçmişi yok.</div>}
                </div>
              </section>
            </div>

            {(manifest?.constraints.length || manifest?.protectedPaths.length) ? <section className="pc9-guardrails">
              <div><span>PROJECT GUARDRAILS</span><strong>Taso’nun koruması gereken sınırlar</strong></div>
              <div className="pc9-guardrail-grid">
                {(manifest?.constraints ?? []).slice(0, 6).map((constraint) => <p key={constraint}>{constraint}</p>)}
                {(manifest?.protectedPaths ?? []).slice(0, 6).map((path) => <code key={path}>{path}</code>)}
              </div>
            </section> : null}
          </>}
        </main>
      </div>
    </section>
  );
}
