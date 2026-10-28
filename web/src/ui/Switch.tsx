import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { clsx } from '@/util';

type SwitchProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'value'> & {
  on: boolean;
  onChange: (on: boolean) => void;
  /** the accessible name when no <label> wraps it */
  label?: string;
  /** the model hub's green switch (`hub-switch`) instead of the app's `toggle` */
  hub?: boolean;
};

/**
 * The on/off control: the app's `toggle` (or the hub's `hub-switch`) as a `role="switch"` button — never a raw
 * checkbox. A <button> is labelable, so a wrapping <label> (see SwitchLine) toggles it when its text is clicked.
 */
export function Switch({ on, onChange, label, hub, className, onClick, ...rest }: SwitchProps) {
  return (
    <button
      {...rest}
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={rest['aria-label'] ?? label}
      className={clsx(hub ? 'hub-switch' : 'toggle', on && 'on', className)}
      onClick={(e) => { onClick?.(e); if (!e.defaultPrevented) onChange(!on); }}
    />
  );
}

/** A small switch with its words, inline among other controls of a row (a candidate's / a bot's options). */
export function SwitchChip({ children, className, title, ...props }: SwitchProps & { children: ReactNode }) {
  return (
    <label className={clsx('switch-inline', props.disabled && 'disabled', className)} title={title}>
      {children}
      <Switch {...props} />
    </label>
  );
}

/** A switch with its text on the left, the switch on the right; clicking the text flips it too. */
export function SwitchLine({ children, hint, className, title, ...props }: SwitchProps & { children: ReactNode; hint?: ReactNode }) {
  return (
    <label className={clsx('switch-line', props.disabled && 'disabled', className)} title={title}>
      <span className="switch-line-text">
        <span className="l">{children}</span>
        {hint && <span className="sub">{hint}</span>}
      </span>
      <Switch {...props} />
    </label>
  );
}
