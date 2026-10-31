import { useId, useRef, useState } from 'react';

/** Keyboard-accessible tabs (arrow keys, Home/End). `tabs`: [{ id, label, content }] */
export default function Tabs({ tabs, label }) {
  const base = useId();
  const [active, setActive] = useState(tabs[0].id);
  const refs = useRef({});
  const move = (e, index) => {
    const keys = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: tabs.length - 1 };
    if (!(e.key in keys)) return;
    e.preventDefault();
    const next = tabs[(keys[e.key] + tabs.length) % tabs.length];
    setActive(next.id);
    refs.current[next.id]?.focus();
  };
  return (
    <div>
      <div role="tablist" aria-label={label} className="flex flex-wrap gap-1 border-b border-slate-700">
        {tabs.map((t, i) => (
          <button
            key={t.id} ref={(el) => { refs.current[t.id] = el; }} role="tab" type="button"
            id={`${base}-tab-${t.id}`} aria-controls={`${base}-panel-${t.id}`} aria-selected={active === t.id}
            tabIndex={active === t.id ? 0 : -1} onClick={() => setActive(t.id)} onKeyDown={(e) => move(e, i)}
            className={`px-3 py-2 text-sm ${active === t.id ? 'border-b-2 border-sky-300 text-white' : 'text-slate-300 hover:text-white'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tabs.map((t) => (
        <div key={t.id} role="tabpanel" id={`${base}-panel-${t.id}`} aria-labelledby={`${base}-tab-${t.id}`} hidden={active !== t.id} className="pt-4">
          {active === t.id && t.content}
        </div>
      ))}
    </div>
  );
}
