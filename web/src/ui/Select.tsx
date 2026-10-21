import { Children, isValidElement, useMemo, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Popover } from '@/features/composer/Popover';
import { Icon } from '@/ui/icons';
import { imeComposing } from '@/ui/ime';
import { clsx } from '@/util';
import { tr } from '@/i18n';
import { nextSelection } from './select-model';

export interface SelectOption {
  value: string;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}

type SelectProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'value' | 'defaultValue' | 'onChange'> & {
  value?: string | number | string[];
  defaultValue?: string | number | string[];
  onValueChange: (value: string | string[]) => void;
  options?: SelectOption[];
  multiple?: boolean;
  placeholder?: ReactNode;
  label?: string;
  searchable?: boolean;
};

function textOf(node: ReactNode): string {
  return Children.toArray(node).map((part) => isValidElement<{ children?: ReactNode }>(part)
    ? textOf(part.props.children) : String(part)).join('');
}

function optionsFromChildren(children: ReactNode): SelectOption[] {
  return Children.toArray(children).flatMap((child) => {
    if (!isValidElement<{ value?: unknown; disabled?: boolean; title?: string; children?: ReactNode }>(child)) return [];
    if (child.type !== 'option') return optionsFromChildren(child.props.children);
    return [{ value: String(child.props.value ?? textOf(child.props.children)), label: child.props.children, description: child.props.title, disabled: child.props.disabled }];
  });
}

export function Select({ value, defaultValue, onValueChange, children, options, multiple = false, disabled, placeholder, label, className, searchable, onClick, onKeyDown, ...rest }: SelectProps) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [own, setOwn] = useState<string | string[] | undefined>(defaultValue === undefined ? undefined : Array.isArray(defaultValue) ? defaultValue : String(defaultValue));
  const list = useMemo(() => options ?? optionsFromChildren(children), [options, children]);
  const current = value ?? own ?? (multiple ? [] : list.find((o) => !o.disabled)?.value ?? '');
  const selected = new Set((Array.isArray(current) ? current : [current]).map(String));
  const chosen = list.filter((o) => selected.has(o.value));
  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return q ? list.filter((o) => `${textOf(o.label)} ${textOf(o.description)}`.toLocaleLowerCase().includes(q)) : list;
  }, [list, query]);
  const name = rest['aria-label'] ?? label ?? rest.title ?? tr('选择');
  const close = (refocus: boolean) => {
    setOpen(false);
    setQuery('');
    if (refocus) anchor.current?.focus();
  };
  const pick = (option: SelectOption) => {
    if (option.disabled) return;
    const next = nextSelection(multiple ? [...selected] : String(current), option.value, multiple);
    if (value === undefined) setOwn(next);
    onValueChange(next);
    if (!multiple) close(true);
  };
  const text = chosen.length
    ? multiple ? (chosen.length === 1 ? chosen[0].label : tr('{n} 项', { n: chosen.length })) : chosen[0].label
    : placeholder ?? (Array.isArray(current) ? '' : String(current));
  return (
    <>
      <button
        {...rest}
        ref={anchor}
        type="button"
        className={clsx('select-trigger', className)}
        disabled={disabled}
        aria-label={rest['aria-label'] ?? label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => { onClick?.(e); if (!e.defaultPrevented) { setOpen((v) => !v); setQuery(''); } }}
        onKeyDown={(e) => {
          onKeyDown?.(e);
          if (e.defaultPrevented || imeComposing(e.nativeEvent)) return;
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setOpen(true); }
          if (e.key === 'Escape' && open) { e.preventDefault(); e.stopPropagation(); close(false); }
        }}
      >
        <span className={clsx('select-trigger-label', !chosen.length && 'select-placeholder')}>{text}</span>
        <Icon name="chevronDown" size={13} />
      </button>
      {open && (
        <Popover anchor={anchor} onClose={close} prefer="down" align="left" className="select-popover" label={name}>
          <div className="select-heading">{name}</div>
          {(searchable ?? list.length > 12) && <input className="select-search field" placeholder={tr('搜索…')} value={query} onChange={(e) => setQuery(e.target.value)} aria-label={tr('搜索选项')} />}
          <div className="select-options">
            {visible.length === 0 && <div className="select-empty">{tr('没有匹配项')}</div>}
            {visible.map((option) => (
              <button
                key={option.value}
                type="button"
                data-mi=""
                className={clsx('select-option', selected.has(option.value) && 'selected')}
                role={multiple ? 'menuitemcheckbox' : 'menuitemradio'}
                aria-checked={selected.has(option.value)}
                disabled={option.disabled}
                onClick={() => pick(option)}
              >
                <span className="select-option-mark">{selected.has(option.value) && <Icon name="check" size={14} />}</span>
                <span className="select-option-text">
                  <span className="select-option-label">{option.label}</span>
                  {option.description && <span className="select-option-description">{option.description}</span>}
                </span>
              </button>
            ))}
          </div>
          {multiple && <div className="select-footer"><button data-mi="" role="menuitem" type="button" className="btn sm" onClick={() => close(true)}>{tr('完成')}</button></div>}
        </Popover>
      )}
    </>
  );
}
