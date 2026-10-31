const LABELS = { clue_discovered: 'Clue', item_gained: 'Item', unlock: 'Unlocked', fact_confirmed: 'Confirmed', event_triggered: 'Event', time_expired: 'Time', item_lost: 'Item' };

export default function NarrationLog({ items }) {
  return (
    <section aria-labelledby="narration-heading" className="rounded-xl border border-slate-700/60 bg-slate-900/70 p-5">
      <h2 id="narration-heading" className="text-sm font-semibold uppercase tracking-wide text-slate-400">What happened</h2>
      <div aria-live="polite" className="mt-3 space-y-4">
        {items.length === 0 && <p className="text-slate-400">Nothing yet. Choose an action.</p>}
        {items.map((item) => (
          <article key={item.id}>
            <p className="text-slate-100">{item.text}</p>
            <ul className="mt-1 space-y-1 text-sm">
              {item.entries.filter((e) => LABELS[e.eventType]).map((e, i) => (
                <li key={i} className="text-amber-200"><span className="font-semibold">{LABELS[e.eventType]}:</span> {e.description}</li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}
