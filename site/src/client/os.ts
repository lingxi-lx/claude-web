export type Os = 'win' | 'mac' | 'other';
export interface NavLike { userAgent: string; platform?: string; maxTouchPoints?: number; userAgentData?: { platform?: string } }

/** Which installer to offer first. Phones, tablets (an iPad says "Mac" but has touch) and Linux get both buttons. */
export function detectOs(nav: NavLike): Os {
  if (/iPhone|iPad|iPod|Android/i.test(nav.userAgent)) return 'other';
  const p = nav.userAgentData?.platform || nav.platform || nav.userAgent;
  if (/win/i.test(p)) return 'win';
  if (/mac/i.test(p)) return (nav.maxTouchPoints ?? 0) > 1 ? 'other' : 'mac';
  return 'other';
}
