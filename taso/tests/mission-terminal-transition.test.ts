import assert from 'node:assert/strict';
import test from 'node:test';
import { ProviderRouter, defaultProviders } from '../src/provider-router.js';
import { ProjectRegistry } from '../src/project-registry.js';
import { TaskEngine } from '../src/task-engine.js';

function fixture() {
  const projects = new ProjectRegistry();
  const project = projects.create({slug:'core-mission-transition',name:'Core transition',repository:'test/core',isExisting:true});
  let saves = 0;
  const engine = new TaskEngine(projects, new ProviderRouter(defaultProviders()), undefined, [], () => { saves++; });
  return {projects, project, engine, saves:()=>saves, create:()=>engine.createMission({projectId:project.id,objective:'Check lifecycle integrity',riskLevel:'READ' as const,dataClass:'public' as const})};
}

test('terminal mission cancellation is refused without changing status or persistent state', () => {
  for (const terminal of ['completed','preview_ready','failed'] as const) {
    const {engine, create, saves} = fixture();
    const mission = create();
    engine.transitionMission(mission.id,terminal,'Test completed');
    const previous = saves();
    assert.throws(() => engine.cancelMission(mission.id),/Terminal mission cannot be cancelled/);
    assert.equal(engine.getMission(mission.id)?.status,terminal);
    assert.equal(saves(),previous);
  }
});

test('cancelled mission remains cancelled and a repeated cancel is idempotent', () => {
  const {engine,create,saves} = fixture();
  const mission = create();
  engine.cancelMission(mission.id);
  const before = saves();
  const again = engine.cancelMission(mission.id);
  assert.equal(again.status,'cancelled');
  assert.equal(saves(),before);
  assert.throws(()=>engine.scheduleAutomaticRetry(mission.id,'must not retry',100),/Cancelled mission/);
});

test('archived and trashed project cannot schedule queued automatic retry', () => {
  const {projects,project,engine,create} = fixture();
  const mission = create();
  for (const action of ['archive','trash'] as const) {
    projects.setLifecycle(project.id,action);
    assert.throws(()=>engine.scheduleAutomaticRetry(mission.id,'temporary provider issue',200),/restored/);
    assert.equal(engine.getMission(mission.id)?.status,'queued');
  }
  projects.setLifecycle(project.id,'restore');
  const retry = engine.scheduleAutomaticRetry(mission.id,'temporary provider issue',200);
  assert.equal(retry.scheduled,true);
  assert.equal(retry.mission.status,'queued');
});
