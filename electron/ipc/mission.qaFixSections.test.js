import { describe, test, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const mission = require('./mission.cjs');

describe('buildQaFailuresSection', () => {
  test('renders one bullet per task with a lastFailureDetail', () => {
    const tasks = [
      { title: 'Checkout flow', lastFailureDetail: { responsibleAgent: 'Dev', reason: 'fails 6/7 specs' } },
      { title: 'Add logging', status: 'completed' },
    ];
    const section = mission.__buildQaFailuresSectionForTest(tasks);
    expect(section).toContain('Checkout flow');
    expect(section).toContain('Dev');
    expect(section).toContain('fails 6/7 specs');
    expect(section).not.toContain('Add logging');
  });

  test('falls back to a note when no task has a lastFailureDetail', () => {
    const section = mission.__buildQaFailuresSectionForTest([{ title: 'Add logging', status: 'completed' }]);
    expect(section).toContain('No per-task failure reason was captured');
  });
});

describe('buildPriorRosterSection', () => {
  test('lists every non-Lead agent with model and backend', () => {
    const agents = [
      { name: 'Lead', role: 'Orchestrator', model: 'opus', backend: 'claude' },
      { name: 'Dev', role: 'Developer', model: 'sonnet', backend: 'claude' },
    ];
    const section = mission.__buildPriorRosterSectionForTest(agents);
    expect(section).toContain('Dev');
    expect(section).toContain('sonnet');
    expect(section).not.toContain('Lead (Orchestrator)');
  });

  test('falls back to a note when there are no non-Lead agents', () => {
    const section = mission.__buildPriorRosterSectionForTest([{ name: 'Lead', role: 'Orchestrator' }]);
    expect(section).toContain('No prior Dev agents recorded');
  });
});
