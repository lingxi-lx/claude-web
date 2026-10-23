/**
 * Which user agent a page of the built-in browser is loaded with. Everywhere it is the cleaned one (user-agent.ts:
 * search engines give Electron a challenge page) — except Google's sign-in, which rejects exactly that one: a user
 * agent that says Chrome while the page's own `navigator.userAgentData` says only Chromium reads to Google as a
 * browser pretending, and it answers "This browser or app may not be secure". Electron's own user agent, which says
 * what it is, is let through to the normal sign-in (measured 2026-10-23 in a <webview> with real input and no
 * debugger: cleaned → /signin/rejected every time; Electron's own, with or without the app name → the password or a
 * challenge step; Firefox's → rejected too).
 */
const SIGN_IN = new Set(['accounts.google.com', 'accounts.youtube.com']);

export function isSignInPage(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && SIGN_IN.has(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/** The user agent `url` should be loaded with: `honest` (Electron's own) on a sign-in page, `clean` anywhere else. */
export function userAgentFor(url: string, honest: string, clean: string): string {
  return isSignInPage(url) ? honest : clean;
}
