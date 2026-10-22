// Loaded with the home page (small): picks the tier, leaves the poster alone for T2, and otherwise loads the scene when
// the browser is idle. ?poster=1 (scripts/poster.cjs) draws the frozen moment right away.
import { profileOf, readTierEnv, tierOf } from './tier';

const root = document.getElementById('hero-scene');
if (root) {
  const poster = new URLSearchParams(location.search).has('poster');
  const env = readTierEnv();
  const tier = poster ? 'T1' : tierOf(env);
  root.dataset.tier = tier;
  const profile = poster ? { ...profileOf('T1', true), parallax: false } : profileOf(tier, env.finePointer);
  if (profile.live) {
    const go = () => { void import('./main').then((m) => m.startHero(root, { profile, poster })); };
    if (poster) go();
    else if ('requestIdleCallback' in window) requestIdleCallback(go, { timeout: 1500 });
    else setTimeout(go, 300);
  }
}
