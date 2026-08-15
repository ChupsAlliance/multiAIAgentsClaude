import { describe, test, expect, beforeEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const mission = require('./mission.cjs');

describe('buildMissionSummary — surfaces lastFailureDetail for failed_qc/failed_qa tasks', () => {
  beforeEach(() => {
    mission.__setMissionStateForTest(null);
  });

  test('includes a QA/QC failures section for tasks currently failed_qc or failed_qa', () => {
    const state = {
      tasks: [
        {
          id: 't1', title: 'Wire up checkout', status: 'failed_qa', assigned_agent: 'Dev',
          lastFailureDetail: {
            stage: 'qa', reason: 'fails 6/7 Playwright specs, no detail given',
            responsibleAgent: 'Dev', timestamp: 1000,
          },
        },
        { id: 't2', title: 'Add logging', status: 'completed', assigned_agent: 'Dev2' },
      ],
      log: [], file_changes: [],
    };

    const summary = mission.__buildMissionSummaryForTest(state);

    expect(summary).toContain('QA/QC failures');
    expect(summary).toContain('Wire up checkout');
    expect(summary).toContain('fails 6/7 Playwright specs, no detail given');
  });

  test('omits the section entirely when no task currently has a failed_qc/failed_qa status', () => {
    const state = {
      tasks: [{ id: 't1', title: 'Add logging', status: 'completed', assigned_agent: 'Dev2' }],
      log: [], file_changes: [],
    };

    const summary = mission.__buildMissionSummaryForTest(state);

    expect(summary).not.toContain('QA/QC failures');
  });
});
