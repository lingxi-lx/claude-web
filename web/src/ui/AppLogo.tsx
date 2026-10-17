/**
 * The app's mark (web/public/icon.svg): the user's own logo — a black squircle with a white «r / b» and an orange dot
 * (2026-10-17, from the image he sent; redrawn as vectors from measurements, nothing else invented). Drawn inline so
 * the sidebar needs no request; in a light theme the square stays dark (it is the brand, not a surface).
 * scripts/icons.cjs renders the PNGs from icon.svg — change both together.
 */
const SQUIRCLE = 'M100 50L99.92 66.9L99.66 72.96L99.24 77.42L98.64 81.04L97.86 84.1L96.9 86.74L95.76 89.06L94.41 91.08L92.86 92.86L91.08 94.41L89.06 95.76L86.74 96.9L84.1 97.86L81.04 98.64L77.42 99.24L72.96 99.66L66.9 99.92L50 100L33.1 99.92L27.04 99.66L22.58 99.24L18.96 98.64L15.9 97.86L13.26 96.9L10.94 95.76L8.92 94.41L7.14 92.86L5.59 91.08L4.24 89.06L3.1 86.74L2.14 84.1L1.36 81.04L0.76 77.42L0.34 72.96L0.08 66.9L0 50L0.08 33.1L0.34 27.04L0.76 22.58L1.36 18.96L2.14 15.9L3.1 13.26L4.24 10.94L5.59 8.92L7.14 7.14L8.92 5.59L10.94 4.24L13.26 3.1L15.9 2.14L18.96 1.36L22.58 0.76L27.04 0.34L33.1 0.08L50 0L66.9 0.08L72.96 0.34L77.42 0.76L81.04 1.36L84.1 2.14L86.74 3.1L89.06 4.24L91.08 5.59L92.86 7.14L94.41 8.92L95.76 10.94L96.9 13.26L97.86 15.9L98.64 18.96L99.24 22.58L99.66 27.04L99.92 33.1Z';

export function AppLogo({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 100 100" aria-hidden focusable="false">
      <path d={SQUIRCLE} fill="#0b0b0b" />
      <g fill="#fff">
        <path d="M9 44.33H33.33V54.67H20.67V69.33H9Z" />
        <path d="M38.2 44.33H49.7L44.3 69.33H32.8Z" />
        <path d="M54 30.67H65.33V69.33H54Z" />
      </g>
      <circle cx="78.33" cy="56.83" r="12.6" fill="#ff5a1f" />
    </svg>
  );
}
