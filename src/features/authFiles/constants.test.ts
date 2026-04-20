import { describe, expect, it } from 'vitest';
import { clearRecoveredAuthFileState, isAccountHealthStale, matchesErrorStatus } from './constants';

describe('auth file constants', () => {
  it('respects explicit stale flags from backend health state', () => {
    expect(
      isAccountHealthStale({
        degraded: true,
        consecutiveFailures: 3,
        failureStatuses: [429, 429, 429],
        stale: true,
      })
    ).toBe(true);
  });

  it('matches error status from account health when file status message is empty', () => {
    expect(
      matchesErrorStatus(
        { name: 'foo.json' },
        ['429'],
        {
          'foo.json': {
            degraded: true,
            degradedStatus: 429,
            consecutiveFailures: 3,
            failureStatuses: [429, 429, 429],
          },
        }
      )
    ).toBe(true);
  });

  it('clears stale file failure markers after recover', () => {
    expect(
      clearRecoveredAuthFileState({
        name: 'foo.json',
        unavailable: true,
        status_message: '401 unauthorized',
        statusMessage: '401 unauthorized',
      })
    ).toMatchObject({
      name: 'foo.json',
      unavailable: false,
      status_message: '',
      statusMessage: '',
    });
  });
});
