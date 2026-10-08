import assert from 'node:assert/strict';
import test from 'node:test';
import { buildServer } from '../src/server.js';

test('project knowledge API creates, lists and updates scoped records', async () => {
  const app = buildServer();
  await app.ready();
  try {
    const projectsResponse = await app.inject({ method: 'GET', url: '/v1/projects' });
    assert.equal(projectsResponse.statusCode, 200);
    const projects = projectsResponse.json<{ projects: Array<{ id: string }> }>().projects;
    const project = projects[0];
    assert.ok(project);
    const projectId = project.id;

    const createResponse = await app.inject({
      method: 'POST',
      url: `/v1/projects/${projectId}/knowledge`,
      payload: {
        kind: 'decision',
        title: 'Keep project isolation',
        body: 'Knowledge records must never be returned across workspace boundaries.',
        tags: ['security', 'workspace'],
      },
    });
    assert.equal(createResponse.statusCode, 201);
    const created = createResponse.json<{ knowledge: { id: string; source: string } }>().knowledge;
    assert.equal(created.source, 'manual');

    const listResponse = await app.inject({ method: 'GET', url: `/v1/projects/${projectId}/knowledge` });
    assert.equal(listResponse.statusCode, 200);
    const listed = listResponse.json<{ knowledge: Array<{ id: string; title: string }> }>().knowledge;
    assert.ok(listed.some((record) => record.id === created.id && record.title === 'Keep project isolation'));

    const patchResponse = await app.inject({
      method: 'PATCH',
      url: `/v1/projects/${projectId}/knowledge/${created.id}`,
      payload: { kind: 'runbook', tags: ['security', 'runbook'] },
    });
    assert.equal(patchResponse.statusCode, 200);
    const updated = patchResponse.json<{ knowledge: { kind: string; tags: string[]; source: string } }>().knowledge;
    assert.equal(updated.kind, 'runbook');
    assert.deepEqual(updated.tags, ['security', 'runbook']);
    assert.equal(updated.source, 'manual');

    const missingResponse = await app.inject({ method: 'GET', url: '/v1/projects/not-a-project/knowledge' });
    assert.equal(missingResponse.statusCode, 404);
  } finally {
    await app.close();
  }
});
