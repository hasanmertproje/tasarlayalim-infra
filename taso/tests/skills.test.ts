import assert from 'node:assert/strict';
import test from 'node:test';
import { getSkill, listSkills, renderSkillGuidance, resolveSkills } from '../src/skills.js';

test('skill registry has unique stable ids and non-empty quality rules', () => {
  const skills = listSkills();
  assert.ok(skills.length >= 10);
  assert.equal(new Set(skills.map((skill) => skill.id)).size, skills.length);
  for (const skill of skills) {
    assert.ok(skill.name.trim());
    assert.ok(skill.specialists.length > 0);
    assert.ok(skill.rules.length > 0);
    assert.ok(skill.acceptance.length > 0);
  }
});

test('unknown skill hints are ignored instead of hallucinated', () => {
  const resolved = resolveSkills(['design-system', 'does-not-exist', 'design-system']);
  assert.deepEqual(resolved.map((skill) => skill.id), ['design-system']);
  assert.equal(getSkill('does-not-exist'), undefined);
});

test('rendered guidance carries rules, anti-patterns and acceptance evidence', () => {
  const guidance = renderSkillGuidance(['responsive-a11y']);
  assert.equal(guidance.length, 1);
  const first = guidance[0];
  assert.ok(first);
  assert.match(first, /rule=/);
  assert.match(first, /avoid=/);
  assert.match(first, /accept=/);
});