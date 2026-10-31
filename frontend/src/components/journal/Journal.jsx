import { useState } from 'react';
import ClueCard from './ClueCard.jsx';
import Button from '../common/Button.jsx';
import EmptyState from '../common/EmptyState.jsx';

export default function Journal({ journal, busy, canWrite, onAddNote }) {
  const [text, setText] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    const value = text.trim();
    if (!value) return;
    const res = await onAddNote(value);
    if (res) setText('');
  };
  return (
    <div className="space-y-6">
      <section aria-labelledby="clues-heading">
        <h3 id="clues-heading" className="text-sm font-semibold text-slate-200">Clues ({journal.clues.length})</h3>
        <div className="mt-2 space-y-2">
          {journal.clues.length === 0 ? <EmptyState title="No clues yet">Inspect things and talk to people.</EmptyState> : journal.clues.map((c) => <ClueCard key={c.id} clue={c} />)}
        </div>
      </section>
      <section aria-labelledby="facts-heading">
        <h3 id="facts-heading" className="text-sm font-semibold text-slate-200">Confirmed facts ({journal.confirmedFacts.length})</h3>
        {journal.confirmedFacts.length === 0 ? (
          <p className="mt-2 text-sm text-slate-400">Nothing confirmed yet.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {journal.confirmedFacts.map((f) => <li key={f.id} className="rounded-md border border-emerald-400/40 bg-emerald-950/30 p-2 text-sm text-emerald-50">{f.text}</li>)}
          </ul>
        )}
      </section>
      <section aria-labelledby="notes-heading">
        <h3 id="notes-heading" className="text-sm font-semibold text-slate-200">Your hypotheses ({journal.playerNotes.length})</h3>
        <p className="mt-1 text-xs text-slate-400">Your own theories. These are not confirmed facts.</p>
        {journal.playerNotes.length > 0 && (
          <ul className="mt-2 space-y-2">
            {journal.playerNotes.map((n, i) => <li key={i} className="rounded-md border border-slate-600 bg-slate-800/60 p-2 text-sm text-slate-100">{n}</li>)}
          </ul>
        )}
        {canWrite && (
          <form onSubmit={submit} className="mt-3 space-y-2">
            <label htmlFor="note-text" className="block text-sm text-slate-300">Add a note</label>
            <textarea
              id="note-text" value={text} onChange={(e) => setText(e.target.value)} maxLength={300} rows={2}
              className="w-full rounded-md border border-slate-600 bg-slate-950 p-2 text-sm text-slate-100"
            />
            <Button type="submit" disabled={busy || !text.trim()}>Save note</Button>
          </form>
        )}
      </section>
    </div>
  );
}
