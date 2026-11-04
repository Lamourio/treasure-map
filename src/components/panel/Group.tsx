import { ReactNode, useState } from 'react';

const OPEN_KEY = 'treasure-map:groups';

function readOpen(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(OPEN_KEY) ?? '{}');
  } catch {
    return {};
  }
}

interface Props {
  title: string;
  children: ReactNode;
  /** Small controls shown at the right of the header. */
  actions?: ReactNode;
  /** When set, the group can be collapsed; its open state is remembered under this id. */
  collapsibleId?: string;
  defaultOpen?: boolean;
}

/** A titled block inside a panel tab. */
export function Group({ title, children, actions, collapsibleId, defaultOpen = true }: Props) {
  const [open, setOpen] = useState(() => (collapsibleId ? readOpen()[collapsibleId] ?? defaultOpen : true));
  const toggle = () => {
    if (!collapsibleId) return;
    setOpen(!open);
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify({ ...readOpen(), [collapsibleId]: !open }));
    } catch {
      /* per-viewer convenience only */
    }
  };
  return (
    <section className="group-card">
      <header className="group-head">
        {collapsibleId ? (
          <button className="group-title collapsible" onClick={toggle} aria-expanded={open}>
            <span className="chev">{open ? '▾' : '▸'}</span>
            {title}
          </button>
        ) : (
          <h3 className="group-title">{title}</h3>
        )}
        {actions && <div className="group-actions">{actions}</div>}
      </header>
      {open && <div className="group-body">{children}</div>}
    </section>
  );
}
