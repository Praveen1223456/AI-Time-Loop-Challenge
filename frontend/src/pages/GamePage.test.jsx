import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import GamePage from './GamePage.jsx';
import * as gameApi from '../services/gameApi.js';
import { makeState, apiError } from '../test/fixtures.js';

vi.mock('../services/gameApi.js');

const Where = () => <p data-testid="where">{useLocation().pathname}</p>;
const renderGame = () => render(
  <MemoryRouter initialEntries={['/game/g1']}>
    <Routes>
      <Route path="/game/:gameId" element={<GamePage />} />
      <Route path="/game/:gameId/ending" element={<Where />} />
    </Routes>
  </MemoryRouter>,
);
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

beforeEach(() => { vi.resetAllMocks(); });
afterEach(cleanup);

describe('GamePage: loading and errors', () => {
  it('shows a loading state, then the game with loop, clock, remaining time and objective', async () => {
    gameApi.getGame.mockResolvedValue(makeState());
    renderGame();
    expect(screen.getByRole('status')).toHaveTextContent(/loading game/i);
    expect(await screen.findByTestId('loop-indicator')).toHaveTextContent('1 of 5');
    expect(screen.getByTestId('clock')).toHaveTextContent('20:45');
    expect(screen.getByTestId('remaining')).toHaveTextContent('15 min');
    expect(screen.getByText(/Stop the blackout/)).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: /time used/i })).toHaveAttribute('aria-valuenow', '0');
  });

  it('shows a retryable error if the game cannot be loaded', async () => {
    gameApi.getGame.mockRejectedValueOnce(apiError('GAME_NOT_FOUND', 'x', 404));
    renderGame();
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be found/i);
  });

  it('explains a session mismatch (403) without leaking details', async () => {
    gameApi.getGame.mockRejectedValue(apiError('FORBIDDEN', 'x', 403));
    renderGame();
    expect(await screen.findByRole('alert')).toHaveTextContent(/different browser session/i);
  });
});

describe('GamePage: actions', () => {
  it('performs an action with the current version, then shows clue, narration, new time and dialogue', async () => {
    gameApi.getGame.mockResolvedValue(makeState());
    gameApi.performAction.mockResolvedValue({
      result: { narrative: '"Reyes pushed an update," says Okoye.', entries: [{ eventType: 'clue_discovered', gameTime: '20:45', description: 'Discovered clue: The silenced alarm' }], outcome: null },
      state: makeState({ stateVersion: 1, time: { current: '20:47', end: '21:00', length: 15, remainingMinutes: 13, expired: false },
        journal: { clues: [{ id: 'c1', title: 'The silenced alarm', description: 'Silenced at 20:41.', persistent: true }], confirmedFacts: [], playerNotes: [] } }),
    });
    renderGame();
    fireEvent.click(await screen.findByRole('button', { name: /Talk to Director Okoye/ }));
    await screen.findByText(/Reyes pushed an update/, { selector: 'p' });
    expect(gameApi.performAction).toHaveBeenCalledWith('g1', { actionId: 'talk_director', targetId: 'okoye', expectedVersion: 0 });
    expect(screen.getByTestId('clock')).toHaveTextContent('20:47');
    expect(screen.getByTestId('dialogue')).toHaveTextContent(/Reyes pushed an update/);
    expect(screen.getByText(/Discovered clue: The silenced alarm/)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Journal \(1\)/ })).toBeInTheDocument();
    expect(screen.getByText('Remembered')).toBeInTheDocument();
  });

  it('prevents duplicate submissions: rapid double-click sends ONE request and disables the buttons meanwhile', async () => {
    gameApi.getGame.mockResolvedValue(makeState());
    const d = deferred();
    gameApi.performAction.mockReturnValue(d.promise);
    renderGame();
    const button = await screen.findByRole('button', { name: /Inspect the control panel/ });
    // Both clicks land in the same tick (before React re-renders the disabled state), so only the
    // synchronous in-flight guard can stop the second request.
    act(() => { fireEvent.click(button); fireEvent.click(button); fireEvent.click(screen.getByRole('button', { name: /Wait one minute/ })); });
    expect(gameApi.performAction).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByRole('button', { name: /Inspect the control panel/ })).toBeDisabled());
    d.resolve({ result: { narrative: 'ok', entries: [], outcome: null }, state: makeState({ stateVersion: 1 }) });
    await waitFor(() => expect(screen.getByRole('button', { name: /Inspect the control panel/ })).toBeEnabled());
  });

  it('on a state conflict, shows a message and refreshes from the server', async () => {
    gameApi.getGame.mockResolvedValueOnce(makeState()).mockResolvedValueOnce(makeState({ stateVersion: 5, turnCount: 3 }));
    gameApi.performAction.mockRejectedValue(apiError('STATE_CONFLICT'));
    renderGame();
    fireEvent.click(await screen.findByRole('button', { name: /Inspect the control panel/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/changed in another tab/i);
    expect(gameApi.getGame).toHaveBeenCalledTimes(2);
    // the next action uses the refreshed version
    gameApi.performAction.mockResolvedValue({ result: { narrative: 'n', entries: [], outcome: null }, state: makeState({ stateVersion: 6 }) });
    fireEvent.click(screen.getByRole('button', { name: /Inspect the control panel/ }));
    await waitFor(() => expect(gameApi.performAction).toHaveBeenLastCalledWith('g1', expect.objectContaining({ expectedVersion: 5 })));
  });

  it('shows a dismissible error for a rejected action without losing the game', async () => {
    gameApi.getGame.mockResolvedValue(makeState());
    gameApi.performAction.mockRejectedValue(apiError('INVALID_ACTION'));
    renderGame();
    fireEvent.click(await screen.findByRole('button', { name: /Wait one minute/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/isn't available/i);
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByTestId('clock')).toHaveTextContent('20:45');
  });

  it('disables actions that do not fit in the remaining time', async () => {
    gameApi.getGame.mockResolvedValue(makeState({ time: { current: '20:59', end: '21:00', length: 15, remainingMinutes: 1, expired: false },
      availableActions: [{ id: 'talk_director', type: 'talk', label: 'Talk to Director Okoye', timeCost: 2, affordable: false }, { id: 'wait_one_minute', type: 'wait', label: 'Wait one minute', timeCost: 1, affordable: true }] }));
    renderGame();
    expect(await screen.findByRole('button', { name: /Talk to Director/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Wait one minute/ })).toBeEnabled();
  });
});

describe('GamePage: loop reset and recap', () => {
  const expired = () => makeState({ time: { current: '21:00', end: '21:00', length: 15, remainingMinutes: 0, expired: true }, availableActions: [] });
  const recap = { loop: 1, endedBy: 'time_expired', endTime: '21:00', turnsTaken: 3, cluesDiscovered: [{ id: 'c1', title: 'The silenced alarm' }], unlocks: [], factsConfirmed: [], eventsTriggered: [{ gameTime: '21:00', description: 'Breaker B-1 opens. Helios-7 goes dark.' }] };

  it('when time expires, offers the next loop; resetting shows an accessible recap dialog', async () => {
    gameApi.getGame.mockResolvedValue(expired());
    gameApi.resetLoop.mockResolvedValue({ recap, state: makeState({ stateVersion: 1, loop: { current: 2, max: 5 } }) });
    renderGame();
    expect(await screen.findByText(/Time has run out/, { selector: 'p.flex-1' })).toBeInTheDocument();
    expect(screen.getByText(/nothing you can do|Time has run out\. Start the next loop/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Start loop 2/ }));
    const dialog = await screen.findByRole('dialog', { name: /Loop 1 recap/ });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveFocus();
    expect(within(dialog).getByText('The silenced alarm')).toBeInTheDocument();
    expect(within(dialog).getByText(/Breaker B-1 opens/)).toBeInTheDocument();
    expect(gameApi.resetLoop).toHaveBeenCalledWith('g1', { reason: 'manual', expectedVersion: 0 });
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByTestId('loop-indicator')).toHaveTextContent('2 of 5');
  });

  it('a manual reset needs confirmation first', async () => {
    gameApi.getGame.mockResolvedValue(makeState());
    gameApi.resetLoop.mockResolvedValue({ recap: { ...recap, endedBy: 'manual' }, state: makeState({ stateVersion: 1, loop: { current: 2, max: 5 } }) });
    renderGame();
    fireEvent.click(await screen.findByRole('button', { name: /Reset the loop/ }));
    expect(gameApi.resetLoop).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Keep playing/ }));
    expect(gameApi.resetLoop).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Reset the loop/ }));
    fireEvent.click(screen.getByRole('button', { name: /Yes, reset/ }));
    await screen.findByRole('dialog');
    expect(gameApi.resetLoop).toHaveBeenCalledTimes(1);
  });

  it('going past the loop limit navigates to the ending', async () => {
    gameApi.getGame.mockResolvedValue(expired());
    gameApi.resetLoop.mockResolvedValue({ recap, state: makeState({ status: 'failed', endingId: 'ending_lost_in_the_loop', availableActions: [] }) });
    renderGame();
    fireEvent.click(await screen.findByRole('button', { name: /Start loop 2/ }));
    expect(await screen.findByTestId('where')).toHaveTextContent('/game/g1/ending');
  });
});

describe('GamePage: outcomes, hints, journal', () => {
  it('navigates to the ending when the server reports victory', async () => {
    gameApi.getGame.mockResolvedValue(makeState());
    gameApi.performAction.mockResolvedValue({ result: { narrative: 'You did it.', entries: [], outcome: { type: 'victory', endingId: 'e' } }, state: makeState({ status: 'completed', endingId: 'e', availableActions: [], stateVersion: 1 }) });
    renderGame();
    fireEvent.click(await screen.findByRole('button', { name: /Inspect the control panel/ }));
    expect(await screen.findByTestId('where')).toHaveTextContent('/game/g1/ending');
  });

  it('a finished game offers the ending and no actions, hints or note form', async () => {
    gameApi.getGame.mockResolvedValue(makeState({ status: 'completed', endingId: 'e', availableActions: [] }));
    renderGame();
    expect(await screen.findByRole('link', { name: /See the ending/ })).toHaveAttribute('href', '/game/g1/ending');
    expect(screen.getByText('This game has ended.', { selector: 'p.mt-3' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Hint 1/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Add a note/)).not.toBeInTheDocument();
  });

  it('requests a hint and displays it; usage count updates', async () => {
    gameApi.getGame.mockResolvedValue(makeState());
    gameApi.requestHint.mockResolvedValue({ hint: { level: 1, grounded: true, text: 'Something worth a closer look can be found at Control Room.' }, state: makeState({ stateVersion: 1, hints: { used: { 1: 1, 2: 0, 3: 0 }, available: true } }) });
    renderGame();
    fireEvent.click(await screen.findByRole('button', { name: /Hint 1/ }));
    expect(await screen.findByText(/closer look can be found at Control Room/)).toBeInTheDocument();
    expect(gameApi.requestHint).toHaveBeenCalledWith('g1', 1);
    expect(screen.getByRole('button', { name: /Hint 1.*\(1\)/ })).toBeInTheDocument();
  });

  it('shows a rate-limit error for hints', async () => {
    gameApi.getGame.mockResolvedValue(makeState());
    gameApi.requestHint.mockRejectedValue(apiError('RATE_LIMITED', 'x', 429));
    renderGame();
    fireEvent.click(await screen.findByRole('button', { name: /Hint 2/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/wait a moment/i);
  });

  it('saves a note, labelled as a hypothesis (not a confirmed fact)', async () => {
    gameApi.getGame.mockResolvedValue(makeState());
    gameApi.addNote.mockResolvedValue({ state: makeState({ stateVersion: 1, journal: { clues: [], confirmedFacts: [], playerNotes: ['Reyes did it?'] } }) });
    renderGame();
    fireEvent.change(await screen.findByLabelText('Add a note'), { target: { value: 'Reyes did it?' } });
    fireEvent.click(screen.getByRole('button', { name: /Save note/ }));
    expect(await screen.findByText('Reyes did it?', { selector: 'li' })).toBeInTheDocument();
    expect(gameApi.addNote).toHaveBeenCalledWith('g1', { text: 'Reyes did it?', expectedVersion: 0 });
    expect(screen.getByText(/not confirmed facts/i)).toBeInTheDocument();
  });

  it('inventory and timeline tabs are reachable by keyboard', async () => {
    gameApi.getGame.mockResolvedValue(makeState({ inventory: [{ id: 'k', name: 'Maintenance keycard', persistent: false }], recentEvents: [{ gameTime: '20:50', eventType: 'event_triggered', description: 'Reyes leaves.' }] }));
    renderGame();
    const journalTab = await screen.findByRole('tab', { name: /Journal/ });
    fireEvent.keyDown(journalTab, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: /Inventory/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Maintenance keycard')).toBeInTheDocument();
    expect(screen.getByText('Resets each loop')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('tab', { name: /Inventory/ }), { key: 'ArrowRight' });
    expect(screen.getByText('Reyes leaves.')).toBeInTheDocument();
  });

  it('never renders solution fields even if the server (wrongly) sent them', async () => {
    gameApi.getGame.mockResolvedValue({ ...makeState(), solutionGuide: { causalChain: ['SECRET CAUSE'] }, winConditions: ['flag:x'] });
    renderGame();
    await screen.findByTestId('clock');
    expect(document.body.textContent).not.toContain('SECRET CAUSE');
  });
});
