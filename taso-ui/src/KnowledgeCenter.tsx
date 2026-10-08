import { FormEvent, useEffect, useMemo, useState } from 'react';

type Project = {
  id: string;
  slug: string;
  name: string;
  repository: string;
};

type ProjectManifest = {
  projectId: string;
  source: 'discovered' | 'manual' | 'imported';
  appType?: string;
  languages: string[];
  frameworks: string[];
  architecture?: string;
  packageManagers: string[];
  databases: string[];
  commands: {
    install?: string;
    lint?: string;
    typecheck?: string;
    test?: string;
    build?: string;
    migrate?: string;
    start?: string;
  };
  deployment: {
    strategy?: string;
    port?: number;
    healthcheck?: string;
  };
  protectedPaths: string[];
  constraints: string[];
  confidence: number;
  discoveredAt: string;
  updatedAt: string;
};

type KnowledgeKind = 'decision' | 'runbook' | 'note' | 'fact';
type KnowledgeSource = 'manual' | 'mission' | 'system';

type KnowledgeRecord = {
  id: string;
  projectId: string;
  kind: KnowledgeKind;
  title: string;
  body: string;
  tags: string[];
  source: KnowledgeSource;
  sourceRef?: string;
  createdAt: string;
  updatedAt: string;
};

const API_URL = ((import.meta.env.VITE_TASO_API_URL as string | undefined) || '/api').replace(/\/$/, '');

const kindLabel: Record<KnowledgeKind, string> = {
  decision: 'DECISION',
  runbook: 'RUNBOOK',
  note: 'NOTE',
  fact: 'FACT',
};

function formatTime(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' });
}

function compactList(values: string[]) {
  return values.length ? values.join(', ') : '—';
}

export default function KnowledgeCenter() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState('');
  const [manifest, setManifest] = useState<ProjectManifest>();
  const [records, setRecords] = useState<KnowledgeRecord[]>([]);
  const [filter, setFilter] = useState<'all' | KnowledgeKind>('all');
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState({ kind: 'decision' as KnowledgeKind, title: '', body: '', tags: '' });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    });
    if (!response.ok) {
      let detail = `${response.status} ${response.statusText}`;
      try {
        const payload = await response.json();
        if (payload?.error) detail = payload.error;
      } catch {
        // Keep HTTP detail.
      }
      throw new Error(detail);
    }
    return response.json() as Promise<T>;
  }

  async function loadProjects() {
    const payload = await requestJson<{ projects: Project[] }>('/v1/projects');
    setProjects(payload.projects ?? []);
    setProjectId((current) => current || payload.projects?.[0]?.id || '');
  }

  async function loadProjectContext(id: string) {
    if (!id) return;
    setLoading(true);
    try {
      const [knowledgePayload, manifestResult] = await Promise.all([
        requestJson<{ knowledge: KnowledgeRecord[] }>(`/v1/projects/${id}/knowledge`),
        requestJson<{ manifest: ProjectManifest }>(`/v1/projects/${id}/manifest`)
          .then((payload) => payload.manifest)
          .catch(() => undefined),
      ]);
      setRecords(knowledgePayload.knowledge ?? []);
      setManifest(manifestResult);
      setError('');
    } catch (cause) {
      setRecords([]);
      setManifest(undefined);
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadProjects().catch((cause) => setError((cause as Error).message));
  }, []);

  useEffect(() => {
    if (projectId) void loadProjectContext(projectId);
  }, [projectId]);

  const selectedProject = projects.find((project) => project.id === projectId);
  const visibleRecords = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return records
      .filter((record) => filter === 'all' || record.kind === filter)
      .filter((record) => !needle || [record.title, record.body, ...record.tags].some((value) => value.toLowerCase().includes(needle)))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [records, filter, query]);

  const counters = useMemo(() => {
    const count = (kind: KnowledgeKind) => records.filter((record) => record.kind === kind).length;
    return {
      total: records.length,
      decision: count('decision'),
      runbook: count('runbook'),
      note: count('note'),
      fact: count('fact'),
    };
  }, [records]);

  async function createRecord(event: FormEvent) {
    event.preventDefault();
    if (!projectId || !draft.title.trim() || !draft.body.trim()) return;
    setSaving(true);
    try {
      await requestJson(`/v1/projects/${projectId}/knowledge`, {
        method: 'POST',
        body: JSON.stringify({
          kind: draft.kind,
          title: draft.title.trim(),
          body: draft.body.trim(),
          tags: draft.tags.split(',').map((item) => item.trim()).filter(Boolean),
          source: 'manual',
        }),
      });
      setDraft({ kind: draft.kind, title: '', body: '', tags: '' });
      await loadProjectContext(projectId);
    } catch (cause) {
      setError(`Knowledge kaydı oluşturulamadı: ${(cause as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="knowledge-center" aria-label="Taso Knowledge Center">
      <header className="knowledge-hero">
        <div>
          <span className="knowledge-eyebrow">PROJECT-SCOPED CONTEXT</span>
          <h2>Knowledge Center</h2>
          <p>Kararlar, runbook’lar, doğrulanmış teknik notlar ve proje manifesti. Semantic memory iddiası yok; görünen her kayıt persist edilen gerçek Core verisidir.</p>
        </div>
        <div className="knowledge-project-control">
          <label>Workspace</label>
          <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
          <small>{selectedProject?.repository ?? 'Workspace bekleniyor…'}</small>
        </div>
      </header>

      {error && <div className="knowledge-error">{error}</div>}

      <div className="knowledge-stats">
        <article><span>TOPLAM</span><strong>{counters.total}</strong><small>persist edilen kayıt</small></article>
        <article><span>DECISION</span><strong>{counters.decision}</strong><small>mimari / ürün kararı</small></article>
        <article><span>RUNBOOK</span><strong>{counters.runbook}</strong><small>operasyon prosedürü</small></article>
        <article><span>FACT + NOTE</span><strong>{counters.fact + counters.note}</strong><small>doğrulanmış bağlam</small></article>
      </div>

      <div className="knowledge-layout">
        <section className="knowledge-panel manifest-panel">
          <div className="knowledge-section-head"><span>PROJECT MANIFEST</span><small>{manifest ? `${Math.round(manifest.confidence * 100)}% confidence` : 'tanımlı değil'}</small></div>
          {manifest ? (
            <div className="manifest-grid">
              <div><span>Source</span><strong>{manifest.source}</strong></div>
              <div><span>App type</span><strong>{manifest.appType ?? '—'}</strong></div>
              <div><span>Languages</span><strong>{compactList(manifest.languages)}</strong></div>
              <div><span>Frameworks</span><strong>{compactList(manifest.frameworks)}</strong></div>
              <div><span>Architecture</span><strong>{manifest.architecture ?? '—'}</strong></div>
              <div><span>Databases</span><strong>{compactList(manifest.databases)}</strong></div>
              <div className="wide"><span>Protected paths</span><strong>{compactList(manifest.protectedPaths)}</strong></div>
              <div className="wide"><span>Constraints</span><strong>{compactList(manifest.constraints)}</strong></div>
              <div className="wide"><span>Build / test</span><strong>{manifest.commands.build || '—'} · {manifest.commands.test || '—'}</strong></div>
              <div className="wide"><span>Deployment</span><strong>{manifest.deployment.strategy || '—'} · {manifest.deployment.healthcheck || '—'}</strong></div>
              <div className="wide manifest-time"><span>Updated</span><strong>{formatTime(manifest.updatedAt)}</strong></div>
            </div>
          ) : <div className="knowledge-empty">Bu workspace için manifest bulunamadı.</div>}
        </section>

        <section className="knowledge-panel create-panel">
          <div className="knowledge-section-head"><span>ADD KNOWLEDGE</span><small>manual provenance</small></div>
          <form className="knowledge-form" onSubmit={createRecord}>
            <div className="knowledge-form-row">
              <label>Tür<select value={draft.kind} onChange={(event) => setDraft((current) => ({ ...current, kind: event.target.value as KnowledgeKind }))}><option value="decision">Decision</option><option value="runbook">Runbook</option><option value="note">Note</option><option value="fact">Fact</option></select></label>
              <label>Etiketler<input value={draft.tags} onChange={(event) => setDraft((current) => ({ ...current, tags: event.target.value }))} placeholder="deploy, ci, auth" /></label>
            </div>
            <label>Başlık<input value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} maxLength={160} placeholder="Örn. Production deploy onay politikası" /></label>
            <label>İçerik<textarea value={draft.body} onChange={(event) => setDraft((current) => ({ ...current, body: event.target.value }))} maxLength={6000} placeholder="Kararı veya runbook adımını net ve doğrulanabilir biçimde yaz." /></label>
            <div className="knowledge-form-foot"><small>Kaynak: MANUAL · Workspace dışına çıkmaz.</small><button type="submit" disabled={saving || !projectId || !draft.title.trim() || !draft.body.trim()}>{saving ? 'Kaydediliyor…' : 'Kaydı ekle'}</button></div>
          </form>
        </section>
      </div>

      <section className="knowledge-panel records-panel">
        <div className="knowledge-record-toolbar">
          <div className="knowledge-section-head"><span>KNOWLEDGE RECORDS</span><small>{visibleRecords.length} visible</small></div>
          <div className="knowledge-toolbar-controls">
            <select value={filter} onChange={(event) => setFilter(event.target.value as 'all' | KnowledgeKind)}><option value="all">Tümü</option><option value="decision">Decision</option><option value="runbook">Runbook</option><option value="note">Note</option><option value="fact">Fact</option></select>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Başlık, içerik veya tag ara" />
            <button type="button" disabled={loading || !projectId} onClick={() => void loadProjectContext(projectId)}>{loading ? '…' : '↻'}</button>
          </div>
        </div>
        <div className="knowledge-record-grid">
          {visibleRecords.map((record) => (
            <article className={`knowledge-record kind-${record.kind}`} key={record.id}>
              <div className="knowledge-record-top"><span>{kindLabel[record.kind]}</span><small>{record.source.toUpperCase()}</small></div>
              <h3>{record.title}</h3>
              <p>{record.body}</p>
              <div className="knowledge-tags">{record.tags.map((tag) => <span key={tag}>{tag}</span>)}{record.tags.length === 0 && <span>no tags</span>}</div>
              <footer><span>{formatTime(record.updatedAt)}</span><code>{record.id.slice(0, 8)}</code></footer>
            </article>
          ))}
          {!loading && visibleRecords.length === 0 && <div className="knowledge-empty">Bu filtre için kayıt yok.</div>}
        </div>
      </section>
    </section>
  );
}
