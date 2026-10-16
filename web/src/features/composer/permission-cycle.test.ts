import { describe, expect, it } from 'vitest';
import { PERMISSION_MODES, PERMISSION_MODE_ORDER, nextPermissionMode } from '@/ui/terms';

describe('Shift+Tab permission cycle', () => {
  it('goes round the safe modes and never lands on a dangerous one', () => {
    const safe = PERMISSION_MODE_ORDER.filter((m) => !PERMISSION_MODES[m].danger);
    let m = safe[0];
    const seen: string[] = [];
    for (let i = 0; i < safe.length; i++) { seen.push(m); m = nextPermissionMode(m); }
    expect(m).toBe(safe[0]);
    expect(new Set(seen).size).toBe(safe.length);
    expect(seen.some((x) => PERMISSION_MODES[x as keyof typeof PERMISSION_MODES].danger)).toBe(false);
  });
  it('from a dangerous mode it goes back to the first safe one', () => {
    const danger = PERMISSION_MODE_ORDER.find((m) => PERMISSION_MODES[m].danger);
    if (danger) expect(nextPermissionMode(danger)).toBe(PERMISSION_MODE_ORDER.filter((m) => !PERMISSION_MODES[m].danger)[0]);
  });
});
