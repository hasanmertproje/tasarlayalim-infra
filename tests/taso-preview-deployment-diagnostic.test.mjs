import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyDeploymentFailure} from '../scripts/taso-preview-deployment-diagnostic.mjs';

test('classifies first actionable failure without returning raw log',()=>{
  const secret='highly-sensitive-token-123';
  const log='Step 4 RUN npm run build\nERROR: TS2345 build failed '+secret;
  assert.equal(classifyDeploymentFailure(log),'SOURCE_BUILD');
  assert.equal(classifyDeploymentFailure(log).includes(secret),false);
});
test('classifies container, disk, network and runtime failures',()=>{
  assert.equal(classifyDeploymentFailure('failed to solve: executor failed running'), 'CONTAINER_BUILD');
  assert.equal(classifyDeploymentFailure('write /app: no space left on device'), 'DISK_CAPACITY');
  assert.equal(classifyDeploymentFailure('get registry.npmjs.org: EAI_AGAIN'), 'DEPENDENCY_INSTALL');
  assert.equal(classifyDeploymentFailure('getaddrinfo ENOTFOUND git.example'), 'NETWORK');
  assert.equal(classifyDeploymentFailure('Error [ERR_MODULE_NOT_FOUND]: cannot find module'), 'RUNTIME_STARTUP');
  assert.equal(classifyDeploymentFailure('health check failed after 30s'), 'HEALTHCHECK');
  assert.equal(classifyDeploymentFailure('unauthorized: authentication required'), 'REGISTRY_AUTH');
});
test('empty and unknown logs are explicit non-success categories',()=>{
  assert.equal(classifyDeploymentFailure('  '),'LOG_UNAVAILABLE');
  assert.equal(classifyDeploymentFailure('Build stopped because condition A failed'),'UNKNOWN');
});
test('ANSI sequences are harmless and no source text enters output contract',()=>{
  assert.equal(classifyDeploymentFailure('\u001b[31mno space left on device\u001b[0m'),'DISK_CAPACITY');
});
