import { useEffect, useMemo, useState } from 'react';

type StepStatus = 'queued' | 'running' | 'completed' | 'failed' | 'blocked' | 'cancelled';
type Specialist = 'frontend' | 'backend' | 'database' | 'security' | 'qa' | 'devops' | 'generalist';

type MissionStep = {
  id: string;
  title: string;
  objective: string;
  specialist: Specialist;
  status: StepStatus;
  dependsOn: string[];
  targetPaths: string[];
  progress: number;
  attempts?: number;
  maxAttempts?: number;
  lastAttemptAt?: string;
  startedAt?: string;
  completedAt?: string;
  outputSummary?: string;
  error?: string;
};

type MissionArtifact = {
  id: string;
  stepId?: string;
  type: string;
  label: string;
  path?: string;
  url?: string;
  summary?: string;
  createdAt: string;
};

type AgentHandoff = {
  id: string;
  fromStepId: string;
  toStepId: string;
  summary: string;
  artifactIds: string[];
  createdAt: string;
};

type AgentRun = {
  id: string;
  label: string;
  specialist?: Specialist | 'repository-publisher';
  stepId?: string;
  status: string;
  action: string;
  progress: number;
};

type WorkspaceCheckpoint = {
  version: number;
  files: Array<{ path: string; producedByStepId: string; updatedAt: string }>;
  completedStepIds: string[];
  updatedAt: string;
};

type Mission = {
  id: string;
  objective: string;
  status: string;
  updatedAt: string;
  execution?: {
    progressPercent?: number;
    currentAction?: string;
    activeAgentRole?: string;
    orchestrationSummary?: string;
    workPlan?: MissionStep[];
    artifacts?: MissionArtifact[];
    handoffs?: AgentHandoff[];
    agentRuns?: AgentRun[];
    pullRequestUrl?: string;
    previewUrl?: string;
    workspaceCheckpoint?: WorkspaceCheckpoint;
    resumeAfterRestart?: boolean;
    ciRepairAttempts?: number;
    maxCiRepairAttempts?: number;
    lastCiFailureSummary?: string;
    runtimeRepairAttempts?: number;
    maxRuntimeRepairAttempts?: number;
    lastRuntimeFailureSummary?: string;
    functionalChecksPlanned?: number;
    functionalChecksPassed?: number;
    lastFunctionalFailureSummary?: string;
  };
};

type Props = {
  expanded?: boolean;
};

const API_URL = ((import.meta.env.VITE_TASO_API_URL as string | undefined) || '/api').replace(/\/$/, '');
const ACTIVE = new Set(['queued', 'planning', 'running', 'testing', 'waiting_approval']);

function specialistLabel(value: Specialist) {
  const labels: Record<Specialist, string> = {
    frontend: 'Frontend',
    backend: 'Backend',
    database: 'Database',
    security: 'Security',
    qa: 'QA',
    devops: 'DevOps',
    generalist: 'Generalist',
  };
  return labels[value];
}

function openMission(missionId: string) {
  window.dispatchEvent(new CustomEvent('taso:open-mission', { detail: { missionId } }));
}

export default function MissionExecutionLive({ expanded = false }: Props) {
  const [missions, setMissions] = useState<Mission[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [error, setError] = useState('');

  async function refresh() {
    try {
      const response = await fetch(`${API_URL}/v1/missions`, { headers: { 'content-type': 'application/json' } });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const payload = await response.json() as { missions?: Mission[] };
      const next = (payload.missions ?? []).filter((mission) => (mission.execution?.workPlan?.length ?? 0) > 0);
      setMissions(next);
      setSelectedId((current) => {
        if (next.some((mission) => mission.id === current)) return current;
        return next.find((mission) => ACTIVE.has(mission.status))?.id ?? next[0]?.id ?? '';
      });
      setError('');
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      if (!document.hidden) void refresh();
    }, 2_000);
    return () => window.clearInterval(timer);
  }, []);

  const mission = useMemo(() => missions.find((item) => item.id === selectedId) ?? missions[0], [missions, selectedId]);
  if (!mission && !error) return null;

  const execution = mission?.execution;
  const steps = execution?.workPlan ?? [];
  const artifacts = execution?.artifacts ?? [];
  const handoffs = execution?.handoffs ?? [];
  const checkpoint = execution?.workspaceCheckpoint;
  const activeRuns = (execution?.agentRuns ?? []).filter((run) => run.status === 'running');
  const progress = Math.max(0, Math.min(100, execution?.progressPercent ?? 0));
  const ciRepairAttempts = execution?.ciRepairAttempts ?? 0;
  const maxCiRepairAttempts = execution?.maxCiRepairAttempts ?? 0;
  const runtimeRepairAttempts = execution?.runtimeRepairAttempts ?? 0;
  const maxRuntimeRepairAttempts = execution?.maxRuntimeRepairAttempts ?? 0;
  const functionalChecksPlanned = execution?.functionalChecksPlanned ?? 0;
  const functionalChecksPassed = execution?.functionalChecksPassed ?? 0;

  return (
    <section className={`mission-execution-live ${expanded ? 'expanded' : ''}`} aria-label="Canlı mission orchestration">
      <div className="mission-execution-head">
        <div>
          <span className="mission-execution-kicker">MISSION ORCHESTRATOR V7 · LIVE 2s</span>
          <strong>{mission?.objective ?? 'Mission execution unavailable'}</strong>
          <small>{execution?.currentAction ?? (error ? `Core error: ${error}` : 'Waiting for execution state…')}</small>
        </div>
        {mission && <button type="button" onClick={() => openMission(mission.id)}>Mission detayını aç ↗</button>}
      </div>

      {missions.length > 1 && (
        <div className="mission-execution-tabs">
          {missions.slice(0, 8).map((item) => (
            <button type="button" className={item.id === mission?.id ? 'active' : ''} key={item.id} onClick={() => setSelectedId(item.id)}>
              <span className={`execution-state state-${item.status}`} />
              {item.objective.slice(0, 48)}
            </button>
          ))}
        </div>
      )}

      {mission && (
        <>
          <div className="mission-live-progress-row">
            <div className="mission-live-progress"><i style={{ width: `${progress}%` }} /></div>
            <b>%{progress}</b>
            <span>{activeRuns.length ? `${activeRuns.length} worker active` : mission.status.toUpperCase()}</span>
            {execution?.resumeAfterRestart && <span>RESTART RESUME ARMED</span>}
            {ciRepairAttempts > 0 && <span>CI SELF-HEAL {ciRepairAttempts}/{maxCiRepairAttempts || '—'}</span>}
            {runtimeRepairAttempts > 0 && <span>RUNTIME SELF-HEAL {runtimeRepairAttempts}/{maxRuntimeRepairAttempts || '—'}</span>}
            {functionalChecksPlanned > 0 && <span>FUNCTIONAL {functionalChecksPassed}/{functionalChecksPlanned}</span>}
          </div>

          {execution?.orchestrationSummary && <p className="mission-orchestration-summary">{execution.orchestrationSummary}</p>}

          <div className="mission-work-graph">
            {steps.map((step, index) => {
              const stepArtifacts = artifacts.filter((artifact) => artifact.stepId === step.id);
              const incoming = handoffs.filter((handoff) => handoff.toStepId === step.id);
              const liveRun = activeRuns.find((run) => run.stepId === step.id);
              const checkpointed = checkpoint?.completedStepIds.includes(step.id) ?? false;
              return (
                <article className={`mission-work-step step-${step.status}`} key={step.id}>
                  <div className="mission-work-step-top">
                    <span>{String(index + 1).padStart(2, '0')}</span>
                    <b>{specialistLabel(step.specialist)} Worker</b>
                    <em>{checkpointed ? 'CHECKPOINTED' : step.status.toUpperCase()}</em>
                  </div>
                  <strong>{step.title}</strong>
                  <p>{liveRun?.action ?? step.objective}</p>
                  <div className="mission-step-progress"><i style={{ width: `${step.progress}%` }} /></div>
                  <div className="mission-step-meta">
                    <span>{step.targetPaths.length ? `${step.targetPaths.length} scoped path` : 'dynamic scope'}</span>
                    <span>{stepArtifacts.length} artifact</span>
                    <span>{incoming.length} handoff</span>
                    {step.maxAttempts !== undefined && <span>attempt {step.attempts ?? 0}/{step.maxAttempts}</span>}
                  </div>
                  {step.targetPaths.length > 0 && <small>Scope: {step.targetPaths.slice(0, 3).join(' · ')}{step.targetPaths.length > 3 ? ` +${step.targetPaths.length - 3}` : ''}</small>}
                  {step.dependsOn.length > 0 && <small>Depends on: {step.dependsOn.join(' · ')}</small>}
                  {step.outputSummary && <small className="mission-step-output">{step.outputSummary}</small>}
                  {step.error && <small className="mission-step-error">{step.error}</small>}
                </article>
              );
            })}
          </div>

          {(artifacts.length > 0 || handoffs.length > 0 || checkpoint || maxCiRepairAttempts > 0 || maxRuntimeRepairAttempts > 0 || functionalChecksPlanned > 0) && (
            <div className="mission-output-grid">
              <div>
                <span>ARTIFACTS</span>
                <strong>{artifacts.length}</strong>
                <small>{artifacts.slice(-3).map((artifact) => artifact.label).join(' · ')}</small>
              </div>
              <div>
                <span>HANDOFFS</span>
                <strong>{handoffs.length}</strong>
                <small>{handoffs.slice(-3).map((handoff) => `${handoff.fromStepId}→${handoff.toStepId}`).join(' · ') || 'No dependency handoff yet'}</small>
              </div>
              <div>
                <span>ACTIVE AGENTS</span>
                <strong>{activeRuns.length}</strong>
                <small>{activeRuns.map((run) => run.label).join(' · ') || 'Idle'}</small>
              </div>
              <div>
                <span>DURABLE CHECKPOINT</span>
                <strong>{checkpoint ? `${checkpoint.completedStepIds.length}/${steps.length}` : '—'}</strong>
                <small>{checkpoint ? `${checkpoint.files.length} file · ${new Date(checkpoint.updatedAt).toLocaleTimeString('tr-TR')}` : 'Not checkpointed yet'}</small>
              </div>
              <div>
                <span>CI SELF-HEAL</span>
                <strong>{maxCiRepairAttempts > 0 ? `${ciRepairAttempts}/${maxCiRepairAttempts}` : 'OFF'}</strong>
                <small>{execution?.lastCiFailureSummary ?? 'No CI repair needed yet'}</small>
              </div>
              <div>
                <span>RUNTIME SELF-HEAL</span>
                <strong>{maxRuntimeRepairAttempts > 0 ? `${runtimeRepairAttempts}/${maxRuntimeRepairAttempts}` : 'OFF'}</strong>
                <small>{execution?.lastRuntimeFailureSummary ?? 'No runtime repair needed yet'}</small>
              </div>
              <div>
                <span>FUNCTIONAL VERIFY</span>
                <strong>{functionalChecksPlanned > 0 ? `${functionalChecksPassed}/${functionalChecksPlanned}` : '—'}</strong>
                <small>{execution?.lastFunctionalFailureSummary ?? (functionalChecksPlanned > 0 ? 'Mission acceptance checks tracked.' : 'Not planned yet')}</small>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}