import type { FastifyInstance } from 'fastify';
import { deriveVerificationSnapshot, type VerificationGate } from './verification-lifecycle.js';

export function registerVerificationRoutes(app: FastifyInstance) {
  app.get('/v1/verification/status', async () => ({
    lifecycle: ['PREVIEW', 'VERIFIED_DEMO', 'PRODUCTION_READY', 'BLOCKED'],
    requiredDemoGates: ['core-tests', 'ci', 'functional', 'browser-qa', 'responsive', 'visual'],
    requiredProductionGates: ['core-tests', 'ci', 'functional', 'browser-qa', 'responsive', 'visual', 'auth-security', 'accessibility', 'approval'],
    productionDeploy: 'explicit-approval-required',
    autoPromotionToProduction: false,
  }));

  app.post<{ Body: { missionId?: string; previewUrl?: string; gates?: VerificationGate[] } }>('/v1/verification/evaluate', async (request, reply) => {
    const missionId = request.body?.missionId?.trim();
    if (!missionId) return reply.code(400).send({ error: 'missionId is required.' });
    if (!Array.isArray(request.body?.gates)) return reply.code(400).send({ error: 'gates array is required.' });
    return {
      verification: deriveVerificationSnapshot({
        missionId,
        previewUrl: request.body.previewUrl,
        gates: request.body.gates.slice(0, 32),
      }),
    };
  });
}
