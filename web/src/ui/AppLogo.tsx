/**
 * The app's mark (web/public/icon.svg, 2026-10-17): a rounded square with block «c/w» and an orange dot. Drawn inline
 * so the sidebar needs no request; in a light theme the square stays dark (it is the brand, not a surface).
 * scripts/icons.cjs renders the PNGs from icon.svg — change both together.
 */
export function AppLogo({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 100 100" aria-hidden focusable="false">
      <rect width="100" height="100" rx="23" fill="#0b0b0b" />
      <g fill="#fff">
        <path d="M11 38h25v9H20v10h16v9H11z" />
        <path d="M38 66h9l10-34h-9z" />
        <path d="M59 38h8v19h3.5V46h8v11H82V38h8v28H59z" />
      </g>
      <circle cx="84" cy="25" r="7" fill="#ff5a1f" />
    </svg>
  );
}
