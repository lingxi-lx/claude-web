/**
 * Files that look like keys or credentials, by name (case-insensitive): never carried off this machine by a hand-off
 * (handoff/git.ts) or a publish (publish/core.ts), even when the user picked "include new files" / the page links them.
 */
export function isSecretFile(rel: string): boolean {
  const name = rel.split(/[\\/]/).pop()!.toLowerCase();
  return name.startsWith('.env') || name.startsWith('id_rsa') || name.startsWith('id_ed25519') || name.startsWith('credentials')
    || name === '.npmrc' || name === '.pypirc' || name === '.netrc' || /\.(pem|key|p12|pfx)$/.test(name);
}
