import type { FastifyInstance } from 'fastify';
import type { Mission } from './domain.js';

export type VerificationGateState = 'passed' | 'failed' | 'pending' | 'not-configured' | 'skipped';
export type VerificationLifecycleState = 'PREVIEW' | 'VERIFIED_DEMO' | 'PRODUCTION_READY' | 'BLOCKED';

export type VerificationGate = {
  id: string;
  label: string;
  state: VerificationGateState;
  blocker?: boolean;
  summary?: string;
  evidenceUrl?: string;
};

export type VerificationSnapshot = {
  missionId: string;
  state: VerificationLifecycleState;
  generatedAt: string;
  previewUrl?: string;
  gates: VerificationGate[];
  blockers: VerificationGate[];
  pending: VerificationGate[];
  passed: VerificationGate[];
  productionCandidate: boolean;
  verifiedDemo: boolean;
  productionReady: boolean;
  summary: string;
};

const REQUIRED_DEMO_GATES = ['core-tests', 'ci', 'functional', 'browser-qa', 'responsive', 'visual'];
const REQUIRED_PRODUCTION_GATES = [...REQUIRED_DEMO_GATES, 'auth-security', 'accessibility', 'approval'];

function gateMap(gates: VerificationGate[]) {
  return new Map(gates.map((gate) => [gate.id, gate]));
}

function isPassed(map: Map<string, VerificationGate>, id: string) {
  return map.get(id)?.state === 'passed';
}

function summaryFor(state: VerificationLifecycleState, blockers: number, pending: number) {
  if (state === 'BLOCKED') return `${blockers} blocker verification gate prevents promotion.`;
  if (state === 'PRODUCTION_READY') return 'All configured production gates passed; candidate is production ready.';
  if (state === 'VERIFIED_DEMO') return pending ? `Verified demo is ready; ${pending} production gate(s) remain pending.` : 'Verified demo is ready.';
  return pending ? `Preview exists; ${pending} verification gate(s) remain pending.` : 'Preview exists and is awaiting verification evidence.';
}

export function deriveVerificationSnapshot(input: {
  missionId: string;
  previewUrl?: string;
  gates: VerificationGate[];
}): VerificationSnapshot {
  const gates = input.gates.map((gate) => ({ ...gate, blocker: gate.blocker ?? gate.state === 'failed' }));
  const map = gateMap(gates);
  const blockers = gates.filter((gate) => gate.blocker && gate.state === 'failed');
  const pending = gates.filter((gate) => gate.state === 'pending' || gate.state === 'not-configured');
  const passed = gates.filter((gate) => gate.state === 'passed');
  const demoPassed = REQUIRED_DEMO_GATES.every((id) => isPassed(map, id));
  const productionPassed = REQUIRED_PRODUCTION_GATES.every((id) => isPassed(map, id));
  const state: VerificationLifecycleState = blockers.length
    ? 'BLOCKED'
    : productionPassed
      ? 'PRODUCTION_READY'
      : demoPassed
        ? 'VERIFIED_DEMO'
        : 'PREVIEW';

  return {
    missionId: input.missionId,
    state,
    generatedAt: new Date().toISOString(),
    previewUrl: input.previewUrl,
    gates,
    blockers,
    pending,
    passed,
    productionCandidate: demoPassed && !blockers.length,
    verifiedDemo: state === 'VERIFIED_DEMO' || state === 'PRODUCTION_READY',
    productionReady: state === 'PRODUCTION_READY',
    summary: summaryFor(state, blockers.length, pending.length),
  };
}

function gate(id: string, label: string, state: VerificationGateState, summary?: string): VerificationGate {
  return { id, label, state, summary };
}

export function missionVerificationGates(mission: Mission): VerificationGate[] {
  const execution = mission.execution;
  const artifacts = execution?.artifacts ?? [];
  const has = (type: string) => artifacts.some((artifact) => artifact.type === type);
  const checks = execution?.checkState;
  const preview = execution?.previewUrl;
  const functional = has('functional-verification');

  return [
    gate('core-tests', 'Core tests', checks === 'success' ? 'passed' : checks === 'failure' ? 'failed' : 'pending'),
    gate('ci', 'CI', checks === 'success' ? 'passed' : checks === 'failure' ? 'failed' : 'pending'),
    gate('functional', 'Functional verification', functional ? 'passed' : 'pending'),
    gate('browser-qa', 'Browser QA', preview ? 'pending' : 'not-configured', preview ? 'Preview available for Browser Operator verification.' : 'No preview URL available.'),
    gate('responsive', 'Responsive QA', preview ? 'pending' : 'not-configured'),
    gate('visual', 'Visual QA', preview ? 'pending' : 'not-configured'),
    gate('auth-security', 'Auth & security', 'pending'),
    gate('accessibility', 'Accessibility', 'pending'),
    gate('approval', 'Production approval', mission.riskLevel === 'HIGH_IMPACT' ? 'pending' : 'passed'),
  ];
}

export function registerVerificationLifecycleRoutes(
  app: FastifyInstance,
  missionById: (id: string) => Mission | undefined,
) {
  app.get<{ Params: { id: string } }>('/v1/missions/:id/verification', async (request, reply) => {
    const mission = missionById(request.params.id);
    if (!mission) return reply.code(404).send({ error: 'Mission not found.' });
    return { verification: deriveVerificationSnapshot({
      missionId: mission.id,
      previewUrl: mission.execution?.previewUrl,
      gates: missionVerificationGates(mission),
    }) };
  });

  app.post<{ Params: { id: string }; Body: { gates?: VerificationGate[]; previewUrl?: string } }>(
    '/v1/missions/:id/verification/evaluate',
    async (request, reply) => {
      const mission = missionById(request.params.id);
      if (!mission) return reply.code(404).send({ error: 'Mission not found.' });
      const supplied = Array.isArray(request.body?.gates) ? request.body.gates.slice(0, 32) : missionVerificationGates(mission);
      return { verification: deriveVerificationSnapshot({
        missionId: mission.id,
        previewUrl: request.body?.previewUrl || mission.execution?.previewUrl,
        gates: supplied,
      }) };
    },
  );
}
