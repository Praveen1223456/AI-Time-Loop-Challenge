import Modal from '../common/Modal.jsx';
import Button from '../common/Button.jsx';

const Section = ({ title, items, render }) =>
  items.length > 0 && (
    <section className="mt-3">
      <h3 className="text-sm font-semibold text-slate-200">{title}</h3>
      <ul className="mt-1 list-disc pl-5 text-sm text-slate-300">{items.map(render)}</ul>
    </section>
  );

export default function RecapModal({ recap, nextLoop, onClose }) {
  return (
    <Modal title={`Loop ${recap.loop} recap`} onClose={onClose}>
      <p className="text-slate-300">
        {recap.endedBy === 'time_expired' ? 'Time ran out' : 'You reset the loop'} at {recap.endTime} after {recap.turnsTaken} action{recap.turnsTaken === 1 ? '' : 's'}.
        Temporary things reset; what you learned stays with you.
      </p>
      <Section title="Clues found" items={recap.cluesDiscovered} render={(c) => <li key={c.id}>{c.title}</li>} />
      <Section title="Newly unlocked" items={recap.unlocks} render={(u) => <li key={u}>{u}</li>} />
      <Section title="Facts confirmed" items={recap.factsConfirmed} render={(f) => <li key={f}>{f}</li>} />
      <Section title="What happened" items={recap.eventsTriggered} render={(e, i) => <li key={i}>{e.gameTime}: {e.description}</li>} />
      {recap.cluesDiscovered.length + recap.unlocks.length + recap.factsConfirmed.length === 0 && (
        <p className="mt-3 text-sm text-slate-400">You learned nothing new this loop. Try something different.</p>
      )}
      <div className="mt-5 flex justify-end">
        <Button variant="primary" onClick={onClose}>{nextLoop ? `Begin loop ${nextLoop}` : 'Close'}</Button>
      </div>
    </Modal>
  );
}
