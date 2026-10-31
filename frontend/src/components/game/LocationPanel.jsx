export default function LocationPanel({ state }) {
  const { location, accessibleLocations } = state;
  return (
    <section aria-labelledby="location-heading" className="rounded-xl border border-slate-700/60 bg-slate-900/70 p-5">
      <h2 id="location-heading" className="text-sm font-semibold uppercase tracking-wide text-slate-400">Current location</h2>
      <p className="mt-1 text-2xl font-semibold text-white">{location.name}</p>
      <p className="mt-2 text-slate-300">{location.description}</p>
      <p className="mt-3 text-sm text-slate-400">
        Known places: {accessibleLocations.map((l) => l.name).join(', ')}
      </p>
    </section>
  );
}
