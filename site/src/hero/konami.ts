// ↑ ↑ ↓ ↓ ← → ← → B A: opens the scene's debug panel (speed, seed, fps).
export const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];

export function konamiDetector(): (key: string) => boolean {
  let i = 0;
  return (key) => {
    const k = key.length === 1 ? key.toLowerCase() : key;
    if (k === KONAMI[i]) {
      i++;
      if (i === KONAMI.length) { i = 0; return true; }
      return false;
    }
    // an extra Up after Up Up still leaves Up Up; any other Up is a new start
    i = k === 'ArrowUp' ? (i === 2 ? 2 : 1) : 0;
    return false;
  };
}
