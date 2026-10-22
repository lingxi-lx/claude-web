import { describe, expect, it } from 'vitest';
import { detectOs } from './os';

const WIN_CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const MAC_SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
const LINUX = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

describe('detectOs', () => {
  it('Windows and macOS desktops', () => {
    expect(detectOs({ userAgent: WIN_CHROME, platform: 'Win32' })).toBe('win');
    expect(detectOs({ userAgent: MAC_SAFARI, platform: 'MacIntel', maxTouchPoints: 0 })).toBe('mac');
  });
  it('prefers userAgentData when the browser has it', () => {
    expect(detectOs({ userAgent: LINUX, platform: 'Linux x86_64', userAgentData: { platform: 'Windows' } })).toBe('win');
    expect(detectOs({ userAgent: WIN_CHROME, userAgentData: { platform: 'macOS' } })).toBe('mac');
  });
  it('phones, tablets and Linux get both buttons', () => {
    expect(detectOs({ userAgent: IPHONE, platform: 'iPhone' })).toBe('other');
    expect(detectOs({ userAgent: ANDROID, platform: 'Linux armv8l' })).toBe('other');
    expect(detectOs({ userAgent: MAC_SAFARI, platform: 'MacIntel', maxTouchPoints: 5 })).toBe('other');
    expect(detectOs({ userAgent: LINUX, platform: 'Linux x86_64' })).toBe('other');
    expect(detectOs({ userAgent: '' })).toBe('other');
  });
});
