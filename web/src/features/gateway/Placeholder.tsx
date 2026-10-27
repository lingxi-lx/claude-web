/** What a mount point shows until the part from another branch lands (mounts.tsx). */
export function Placeholder({ mount, title, note }: { mount: string; title: string; note: string }) {
  return (
    <div className="gw-privacy-placeholder" data-mount={mount}>
      <div className="l">{title}</div>
      <div className="sub">{note}</div>
    </div>
  );
}
