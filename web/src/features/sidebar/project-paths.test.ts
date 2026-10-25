import { describe, expect, it } from 'vitest';
import { isWinPath, samePath } from './project-paths';

describe('编辑项目: the same folder twice (C-U4)', () => {
  it('Windows paths compare without case, separators and a trailing slash; others keep case', () => {
    expect(isWinPath('C:\\proj')).toBe(true);
    expect(isWinPath('\\\\nas\\share')).toBe(true);
    expect(isWinPath('/home/me')).toBe(false);
    expect(samePath('C:\\Proj\\lib', 'c:/proj/LIB/', true)).toBe(true);
    expect(samePath('/home/me/Lib', '/home/me/lib', false)).toBe(false);
    expect(samePath('/home/me/lib/', '/home/me/lib', false)).toBe(true);
  });
});
