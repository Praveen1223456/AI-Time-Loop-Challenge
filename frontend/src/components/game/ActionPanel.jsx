const GROUPS = [
  { id: 'travel', title: 'Travel', types: ['travel'] },
  { id: 'investigate', title: 'Investigate and act', types: ['inspect', 'interact', 'use_item'] },
  { id: 'talk', title: 'Talk', types: ['talk'] },
  { id: 'wait', title: 'Wait', types: ['wait'] },
];

export default function ActionPanel({ state, busy, onAction }) {
  const { availableActions, status, time } = state;
  const disabledAll = busy || status !== 'active' || time.expired;
  return (
    <section aria-labelledby="actions-heading" className="rounded-xl border border-slate-700/60 bg-slate-900/70 p-5">
      <h2 id="actions-heading" className="text-sm font-semibold uppercase tracking-wide text-slate-400">What will you do?</h2>
      {availableActions.length === 0 ? (
        <p className="mt-3 text-slate-300">
          {status !== 'active' ? 'This game has ended.' : time.expired ? 'Time has run out. Start the next loop to continue.' : 'There is nothing you can do right now.'}
        </p>
      ) : (
        <div className="mt-3 space-y-4">
          {GROUPS.map((g) => {
            const actions = availableActions.filter((a) => g.types.includes(a.type));
            if (!actions.length) return null;
            return (
              <div key={g.id}>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{g.title}</h3>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {actions.map((a) => (
                    <li key={a.id}>
                      <button
                        type="button"
                        onClick={() => onAction(a)}
                        disabled={disabledAll || !a.affordable}
                        title={!a.affordable ? 'Not enough time left in this loop' : undefined}
                        className="rounded-md border border-slate-500 bg-slate-800 px-3 py-2 text-left text-sm text-slate-100 hover:bg-slate-700 disabled:cursor-not-allowed disabled:border-slate-700 disabled:text-slate-500"
                      >
                        {a.label} <span className="text-slate-400">· {a.timeCost} min</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
