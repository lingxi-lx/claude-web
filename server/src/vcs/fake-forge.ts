// Tests only (e2e / ui-smoke): CW_FAKE_FORGE_FILE names a JSON file `{ "<host>": "http://127.0.0.1:<port>" }`;
// requests for those hosts go to the fake forge server instead of https://<host>. Unset in real use.
import fs from 'node:fs';

export const fakeForgeOn = () => !!process.env.CW_FAKE_FORGE_FILE;

export function fakeOrigin(host: string): string | undefined {
  const file = process.env.CW_FAKE_FORGE_FILE;
  if (!file) return undefined;
  try {
    const map = JSON.parse(fs.readFileSync(file, 'utf8'));
    const v = map && typeof map === 'object' && Object.prototype.hasOwnProperty.call(map, host) ? map[host] : undefined;
    return typeof v === 'string' && /^http:\/\/127\.0\.0\.1:\d+$/.test(v) ? v : undefined;
  } catch {
    return undefined;
  }
}
