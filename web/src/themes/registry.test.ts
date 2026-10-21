import { describe, expect, it } from 'vitest';
import { BUILTIN_SOURCES } from './builtin';
import { checkAnim } from '@themes';
import { parsePack } from '@themes';
import { PROCESSES } from '@themes';
import { asciiId, getPack, listPacks } from './registry';

describe('registry', () => {
  it('reads ascii:<id>', () => {
    expect(asciiId('ascii:phosphor')).toBe('phosphor');
    expect(asciiId('ascii:')).toBeNull();
    expect(asciiId('dark')).toBeNull();
    expect(asciiId(undefined)).toBeNull();
  });
  it('every built-in pack parses without a single error, draws all sixteen processes, and has a backdrop', () => {
    for (const s of BUILTIN_SOURCES) {
      const { pack, errors } = parsePack(s.json, s);
      expect(errors, JSON.stringify((s.json as any)?.id)).toEqual([]);
      for (const p of PROCESSES) {
        expect(pack!.processes[p], `${pack!.id}.${p}`).toBeTruthy();
        expect(checkAnim(pack!.processes[p])).toEqual([]);
        expect(pack!.processes[p]!.inline, `${pack!.id}.${p} inline`).toBeTruthy();
      }
      expect(pack!.backdrop?.includes('export default')).toBe(true);
    }
    expect(listPacks().length).toBe(BUILTIN_SOURCES.length);
    expect(new Set(listPacks().map((p) => p.id)).size).toBe(listPacks().length);
  });
  it('an unknown id is no pack', () => expect(getPack('nope')).toBeNull());
});
