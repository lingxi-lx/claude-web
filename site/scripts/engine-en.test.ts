import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { engineEnglish, generated, OUT } from './engine-en.ts';

describe('the engine\'s English', () => {
  const { entries, missing } = engineEnglish();
  it('has every text the café draws', () => {
    expect(missing).toEqual([]);
    expect(entries['CLAUDE 网咖']).toBeTruthy();
    expect(entries['网管']).toBe('the admin');
    expect(entries['小章鱼']).toBeTruthy();
    expect(Object.keys(entries).length).toBeGreaterThan(15);
  });
  it('is committed up to date (npm run engine-en --prefix site)', () => {
    expect(fs.readFileSync(OUT, 'utf8')).toBe(generated(entries));
  });
});
