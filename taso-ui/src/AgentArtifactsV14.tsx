type Artifact = {
  id: string;
  missionId: string;
  stepId?: string;
  type: string;
  label: string;
  path?: string;
  url?: string;
  summary?: string;
  createdAt: string;
};

type Handoff = {
  id: string;
  missionId: string;
  fromStepId: string;
  toStepId: string;
  summary: string;
  artifactIds: string[];
  createdAt: string;
};

type Checkpoint = {
  version: 1;
  files: Array<{ path: string; producedByStepId: string; updatedAt: string }>;
  completedStepIds: string[];
  updatedAt: string;
};

type Step = { id: string; title: string; specialist: string };

type Props = {
  artifacts?: Artifact[];
  handoffs?: Handoff[];
  checkpoint?: Checkpoint;
  steps?: Step[];
};

function rel(value?: string) {
  if (!value) return '—';
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return value;
  const minutes = Math.max(0, Math.floor((Date.now() - time) / 60_000));
  if (minutes < 1) return 'az önce';
  if (minutes < 60) return `${minutes}dk`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}sa`;
  return new Date(value).toLocaleDateString('tr-TR');
}

export default function AgentArtifactsV14({ artifacts = [], handoffs = [], checkpoint, steps = [] }: Props) {
  const stepById = new Map(steps.map((step) => [step.id, step]));
  const artifactById = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
  const files = checkpoint?.files ?? [];

  return (
    <section className="aa14-shell" aria-label="Mission artifacts and handoffs">
      <div className="aa14-head">
        <div><span>MISSION ARTIFACTS</span><strong>Execution outputs</strong></div>
        <div className="aa14-counts"><b>{artifacts.length} artifact</b><b>{handoffs.length} handoff</b><b>{files.length} checkpoint file</b></div>
      </div>

      <div className="aa14-grid">
        <article className="aa14-panel">
          <header><span>ARTIFACTS</span><small>Core execution state</small></header>
          <div className="aa14-list">
            {artifacts.slice().reverse().slice(0, 16).map((artifact) => (
              <div className="aa14-item" key={artifact.id}>
                <i className="artifact" />
                <div><span>{artifact.type} · {artifact.stepId ? stepById.get(artifact.stepId)?.title ?? artifact.stepId : 'mission'}</span><strong>{artifact.label}</strong>{artifact.path && <code>{artifact.path}</code>}{artifact.summary && <p>{artifact.summary}</p>}</div>
                <div className="aa14-meta"><time>{rel(artifact.createdAt)}</time>{artifact.url && <a href={artifact.url} target="_blank" rel="noreferrer">OPEN ↗</a>}</div>
              </div>
            ))}
            {!artifacts.length && <div className="aa14-empty">Mission artifact üretmedi.</div>}
          </div>
        </article>

        <article className="aa14-panel">
          <header><span>HANDOFF CHAIN</span><small>specialist continuity</small></header>
          <div className="aa14-list">
            {handoffs.slice().reverse().slice(0, 12).map((handoff) => {
              const from = stepById.get(handoff.fromStepId);
              const to = stepById.get(handoff.toStepId);
              return (
                <div className="aa14-item handoff" key={handoff.id}>
                  <i className="handoff" />
                  <div><span>{from?.title ?? handoff.fromStepId} → {to?.title ?? handoff.toStepId}</span><strong>{handoff.summary}</strong>{handoff.artifactIds.length > 0 && <p>{handoff.artifactIds.map((id) => artifactById.get(id)?.label ?? id).join(' · ')}</p>}</div>
                  <div className="aa14-meta"><time>{rel(handoff.createdAt)}</time><b>{handoff.artifactIds.length} output</b></div>
                </div>
              );
            })}
            {!handoffs.length && <div className="aa14-empty">Agent handoff kaydı yok.</div>}
          </div>
        </article>

        <article className="aa14-panel checkpoint">
          <header><span>DURABLE CHECKPOINT</span><small>{checkpoint ? `v${checkpoint.version} · ${rel(checkpoint.updatedAt)}` : 'not created'}</small></header>
          {checkpoint ? <>
            <div className="aa14-checkpoint-summary"><div><span>FILES</span><strong>{files.length}</strong></div><div><span>COMPLETED STEPS</span><strong>{checkpoint.completedStepIds.length}</strong></div><div><span>UPDATED</span><strong>{rel(checkpoint.updatedAt)}</strong></div></div>
            <div className="aa14-file-grid">
              {files.slice().reverse().slice(0, 24).map((file) => <div key={`${file.path}:${file.updatedAt}`}><code>{file.path}</code><span>{stepById.get(file.producedByStepId)?.title ?? file.producedByStepId}</span><time>{rel(file.updatedAt)}</time></div>)}
            </div>
          </> : <div className="aa14-empty">Henüz durable workspace checkpoint yok.</div>}
        </article>
      </div>
    </section>
  );
}
