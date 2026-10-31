import { Link, useNavigate, useParams } from 'react-router-dom';
import { useGame } from '../hooks/useGame.js';
import { usePageTitle } from '../hooks/usePageTitle.js';
import { errorMessage } from '../utils/errors.js';
import Spinner from '../components/common/Spinner.jsx';
import ErrorBanner from '../components/common/ErrorBanner.jsx';
import Tabs from '../components/common/Tabs.jsx';
import GameHeader from '../components/game/GameHeader.jsx';
import LocationPanel from '../components/game/LocationPanel.jsx';
import ActionPanel from '../components/game/ActionPanel.jsx';
import NarrationLog from '../components/game/NarrationLog.jsx';
import Timeline from '../components/game/Timeline.jsx';
import HintPanel from '../components/game/HintPanel.jsx';
import LoopControls from '../components/game/LoopControls.jsx';
import RecapModal from '../components/game/RecapModal.jsx';
import CharacterPanel from '../components/dialogue/CharacterPanel.jsx';
import Journal from '../components/journal/Journal.jsx';
import Inventory from '../components/inventory/Inventory.jsx';

export default function GamePage() {
  const { gameId } = useParams();
  const navigate = useNavigate();
  const game = useGame(gameId);
  const { state } = game;
  usePageTitle(state ? `${state.scenario.title}: loop ${state.loop.current}` : 'Loading game');

  if (game.loadError) {
    return (
      <div className="space-y-4">
        <ErrorBanner message={errorMessage(game.loadError)} onRetry={game.reload} />
        <Link to="/" className="text-sky-300 underline">Back to the start</Link>
      </div>
    );
  }
  if (!state) return <Spinner label="Loading game" />;

  const finished = state.status !== 'active';
  const goToEndingIfOver = (res) => { if (res && res.state.status !== 'active') navigate(`/game/${gameId}/ending`); };
  const lastTalk = game.narration.find((n) => n.actionType === 'talk');

  const sidebar = [
    { id: 'journal', label: `Journal (${state.journal.clues.length})`, content: <Journal journal={state.journal} busy={game.busy} canWrite={!finished} onAddNote={game.addNote} /> },
    { id: 'inventory', label: `Inventory (${state.inventory.length})`, content: <Inventory items={state.inventory} /> },
    { id: 'timeline', label: 'Timeline', content: <Timeline events={state.recentEvents} /> },
  ];

  return (
    <div className="space-y-4">
      <h1 className="sr-only">{state.scenario.title}</h1>
      <GameHeader state={state} />
      <ErrorBanner message={game.actionError} onDismiss={game.clearError} />
      {finished && (
        <div role="status" className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-500 bg-slate-900 p-4">
          <p className="flex-1 text-slate-100">This game has ended.</p>
          <Link to={`/game/${gameId}/ending`} className="rounded-md bg-sky-400 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-sky-300">See the ending</Link>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-4">
          <LocationPanel state={state} />
          <ActionPanel state={state} busy={game.busy} onAction={async (a) => goToEndingIfOver(await game.perform(a))} />
          <LoopControls state={state} busy={game.busy} onReset={async () => goToEndingIfOver(await game.reset())} />
          <CharacterPanel characters={state.charactersHere} lastDialogue={lastTalk?.text} />
          <NarrationLog items={game.narration} />
        </div>
        <aside aria-label="Journal, inventory and timeline" className="space-y-6 rounded-xl border border-slate-700/60 bg-slate-900/70 p-4 lg:self-start">
          <Tabs label="Game notebook" tabs={sidebar} />
          {!finished && <HintPanel hints={game.hints} used={state.hints.used} busy={game.busy} disabled={finished} onHint={game.hint} />}
        </aside>
      </div>
      {game.recap && <RecapModal recap={game.recap} nextLoop={finished ? null : state.loop.current} onClose={game.dismissRecap} />}
    </div>
  );
}
