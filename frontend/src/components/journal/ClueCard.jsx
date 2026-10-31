export default function ClueCard({ clue, headingLevel = 4 }) {
  const Heading = `h${headingLevel}`;
  return (
    <article className="rounded-lg border border-amber-400/40 bg-amber-950/30 p-3">
      <div className="flex items-start justify-between gap-2">
        <Heading className="font-medium text-amber-100">{clue.title}</Heading>
        <span className="shrink-0 rounded-full border border-amber-300/50 px-2 py-0.5 text-xs text-amber-100">
          {clue.persistent ? 'Remembered' : 'This loop only'}
        </span>
      </div>
      <p className="mt-1 text-sm text-slate-200">{clue.description}</p>
    </article>
  );
}
