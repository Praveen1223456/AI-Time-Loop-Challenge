export default function CharacterPanel({ characters, lastDialogue }) {
  return (
    <section aria-labelledby="characters-heading" className="rounded-xl border border-slate-700/60 bg-slate-900/70 p-5">
      <h2 id="characters-heading" className="text-sm font-semibold uppercase tracking-wide text-slate-400">People here</h2>
      {characters.length === 0 ? (
        <p className="mt-3 text-slate-400">Nobody else is here right now.</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {characters.map((c) => (
            <li key={c.id}>
              <p className="font-medium text-white">{c.name} <span className="text-sm font-normal text-slate-400">· {c.role}</span></p>
              {c.publicFacts.length > 0 && (
                <ul className="mt-1 list-disc pl-5 text-sm text-slate-300">
                  {c.publicFacts.map((f) => <li key={f}>{f}</li>)}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
      {lastDialogue && (
        <blockquote className="mt-4 border-l-4 border-sky-400 bg-slate-800/60 p-3 text-slate-100" data-testid="dialogue">
          {lastDialogue}
        </blockquote>
      )}
    </section>
  );
}
