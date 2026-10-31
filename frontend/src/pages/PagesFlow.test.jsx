import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import HomePage from './HomePage.jsx';
import CreateScenarioPage from './CreateScenarioPage.jsx';
import HistoryPage from './HistoryPage.jsx';
import EndingPage from './EndingPage.jsx';
import * as gameApi from '../services/gameApi.js';
import * as api from '../services/api.js';
import { makeEnding, apiError } from '../test/fixtures.js';

vi.mock('../services/gameApi.js');

const Where = () => <p data-testid="where">{useLocation().pathname}</p>;
const renderAt = (path, element, route = path) => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes><Route path={route} element={element} /><Route path="/game/:gameId" element={<Where />} /></Routes>
  </MemoryRouter>,
);
const sample = { id: 's1', slug: 'x', title: 'Nine Minutes to Darkness', premise: 'A station loses power.', theme: 'sci-fi', difficulty: 'medium' };
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

beforeEach(() => { vi.resetAllMocks(); vi.spyOn(api, 'getHealth').mockResolvedValue({ status: 'ok', environment: 'test', database: { status: 'connected' }, ai: { configured: true } }); });
afterEach(cleanup);

describe('HomePage', () => {
  it('lists sample scenarios and starts a game once even on a double click', async () => {
    gameApi.listSamples.mockResolvedValue([sample]);
    const d = deferred();
    gameApi.startGame.mockReturnValue(d.promise);
    renderAt('/', <HomePage />);
    const play = await screen.findByRole('button', { name: /Play this scenario/ });
    act(() => { fireEvent.click(play); fireEvent.click(play); }); // same tick: only the ref guard can stop this
    expect(gameApi.startGame).toHaveBeenCalledTimes(1);
    expect(gameApi.startGame.mock.calls[0][0]).toBe('s1');
    d.resolve({ gameId: 'g9' });
    expect(await screen.findByTestId('where')).toHaveTextContent('/game/g9');
  });

  it('has a Start a Time Loop link to the creator and a How to play section', async () => {
    gameApi.listSamples.mockResolvedValue([sample]);
    renderAt('/', <HomePage />);
    expect(await screen.findByRole('link', { name: /Start a Time Loop/ })).toHaveAttribute('href', '/create');
    expect(screen.getByRole('heading', { name: /How to play/ })).toBeInTheDocument();
  });

  it('shows an empty state when there are no samples, and a retryable error when loading fails', async () => {
    gameApi.listSamples.mockResolvedValueOnce([]);
    renderAt('/', <HomePage />);
    expect(await screen.findByText(/No sample scenarios found/)).toBeInTheDocument();
    cleanup();
    gameApi.listSamples.mockRejectedValueOnce(apiError('NETWORK_ERROR', 'x', 0)).mockResolvedValueOnce([sample]);
    renderAt('/', <HomePage />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/can't reach the server/i);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByText('Nine Minutes to Darkness')).toBeInTheDocument();
  });

  it('shows an error if the game cannot be started and lets the user try again', async () => {
    gameApi.listSamples.mockResolvedValue([sample]);
    gameApi.startGame.mockRejectedValueOnce(apiError('SCENARIO_NOT_FOUND', 'x', 404)).mockResolvedValueOnce({ gameId: 'g2' });
    renderAt('/', <HomePage />);
    fireEvent.click(await screen.findByRole('button', { name: /Play this scenario/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be found/i);
    fireEvent.click(screen.getByRole('button', { name: /Play this scenario/ }));
    expect(await screen.findByTestId('where')).toHaveTextContent('/game/g2');
  });
});

describe('CreateScenarioPage', () => {
  const GOOD = 'A museum will be robbed at midnight and I keep waking up an hour earlier.';
  const fill = (text = GOOD) => fireEvent.change(screen.getByLabelText('Your idea'), { target: { value: text } });

  it('has labelled controls for prompt, theme, difficulty and loop length', async () => {
    renderAt('/create', <CreateScenarioPage />);
    for (const l of ['Your idea', 'Theme', 'Difficulty', 'Loop length']) expect(screen.getByLabelText(l)).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Historical Fiction' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Short/ })).toBeInTheDocument();
  });

  it('blocks submission under 30 characters and explains why; nothing is sent', async () => {
    renderAt('/create', <CreateScenarioPage />);
    fill('too short');
    fireEvent.click(screen.getByRole('button', { name: /Generate and play/ }));
    expect(await screen.findByText(/at least 30 characters \(9 so far\)/)).toBeInTheDocument();
    expect(screen.getByLabelText('Your idea')).toHaveAttribute('aria-invalid', 'true');
    expect(gameApi.createScenario).not.toHaveBeenCalled();
  });

  it('submits the chosen options, shows progress, disables the form, then starts the game', async () => {
    const d = deferred();
    gameApi.createScenario.mockReturnValue(d.promise);
    gameApi.startGame.mockResolvedValue({ gameId: 'g7' });
    renderAt('/create', <CreateScenarioPage />);
    fill();
    fireEvent.change(screen.getByLabelText('Theme'), { target: { value: 'mystery' } });
    fireEvent.change(screen.getByLabelText('Difficulty'), { target: { value: 'hard' } });
    fireEvent.change(screen.getByLabelText('Loop length'), { target: { value: 'long' } });
    const submit = screen.getByRole('button', { name: /Generate and play/ });
    act(() => { fireEvent.click(submit); fireEvent.click(submit); }); // same tick: duplicate submit attempt
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Writing and checking/));
    expect(gameApi.createScenario).toHaveBeenCalledTimes(1);
    expect(gameApi.createScenario.mock.calls[0][0]).toEqual({ prompt: GOOD, theme: 'mystery', difficulty: 'hard', loopLength: 'long' });
    expect(screen.getByLabelText('Your idea')).toBeDisabled();
    expect(screen.getByRole('button', { name: /Working/ })).toBeDisabled();
    d.resolve({ scenarioId: 'sc1', title: 'T' });
    expect(await screen.findByTestId('where')).toHaveTextContent('/game/g7');
    expect(gameApi.startGame.mock.calls[0][0]).toBe('sc1');
  });

  it('shows a recoverable error and re-enables the form after a failure', async () => {
    gameApi.createScenario.mockRejectedValueOnce(apiError('SCENARIO_GENERATION_FAILED', 'x', 502));
    renderAt('/create', <CreateScenarioPage />);
    fill();
    fireEvent.click(screen.getByRole('button', { name: /Generate and play/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't build a playable scenario/i);
    expect(screen.getByRole('button', { name: /Generate and play/ })).toBeEnabled();
    expect(screen.getByLabelText('Your idea')).toHaveValue(GOOD); // input preserved
  });

  it('disables generation (with an explanation) when the server has no AI configured', async () => {
    api.getHealth.mockResolvedValue({ status: 'ok', environment: 'test', database: { status: 'connected' }, ai: { configured: false } });
    renderAt('/create', <CreateScenarioPage />);
    expect(await screen.findByRole('note')).toHaveTextContent(/not configured/i);
    expect(screen.getByRole('button', { name: /Generate and play/ })).toBeDisabled();
  });
});

describe('HistoryPage', () => {
  it('shows an empty state', async () => {
    gameApi.listGames.mockResolvedValue({ items: [], total: 0 });
    renderAt('/history', <HistoryPage />);
    expect(await screen.findByText('No games yet')).toBeInTheDocument();
  });

  it('lists games with status, resume / ending links, and paginates', async () => {
    const g = (i, status) => ({ gameId: `g${i}`, title: `Game ${i}`, status, currentLoop: i, updatedAt: '2026-10-28T10:00:00.000Z', scenarioId: 's' });
    gameApi.listGames.mockResolvedValueOnce({ items: [g(1, 'active'), g(2, 'completed'), g(3, 'failed')], total: 4 }).mockResolvedValueOnce({ items: [g(4, 'active')], total: 4 });
    renderAt('/history', <HistoryPage />);
    expect(await screen.findByText('Game 1')).toBeInTheDocument();
    expect(screen.getByText('In progress')).toBeInTheDocument();
    expect(screen.getByText('Won')).toBeInTheDocument();
    expect(screen.getByText('Lost')).toBeInTheDocument();
    const links = screen.getAllByRole('link');
    expect(links.find((l) => l.textContent === 'Resume')).toHaveAttribute('href', '/game/g1');
    expect(links.filter((l) => l.textContent === 'View ending').map((l) => l.getAttribute('href'))).toEqual(['/game/g2/ending', '/game/g3/ending']);
    fireEvent.click(screen.getByRole('button', { name: /Load more/ }));
    expect(await screen.findByText('Game 4')).toBeInTheDocument();
    expect(gameApi.listGames).toHaveBeenLastCalledWith({ limit: 10, skip: 3 }, expect.anything());
    expect(screen.queryByRole('button', { name: /Load more/ })).not.toBeInTheDocument();
  });

  it('shows a retryable error', async () => {
    gameApi.listGames.mockRejectedValueOnce(apiError('NETWORK_ERROR', 'x', 0)).mockResolvedValueOnce({ items: [], total: 0 });
    renderAt('/history', <HistoryPage />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByText('No games yet')).toBeInTheDocument();
  });
});

describe('EndingPage', () => {
  const at = () => renderAt('/game/g1/ending', <EndingPage />, '/game/:gameId/ending');

  it('shows the ending, grounded summary, causal chain, found and missed clues', async () => {
    gameApi.getEnding.mockResolvedValue(makeEnding());
    at();
    expect(await screen.findByRole('heading', { level: 1, name: 'The Lights Stay On' })).toBeInTheDocument();
    expect(screen.getByText('Victory')).toBeInTheDocument();
    expect(screen.getByTestId('summary')).toHaveTextContent(/3 of 6 lasting clues/);
    expect(screen.getByText('A patch disabled the cutoff.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Clues you missed' })).toBeInTheDocument();
  });

  it('shows failure endings as failures', async () => {
    gameApi.getEnding.mockResolvedValue(makeEnding({ objectiveCompleted: false, missedClues: [], ending: { id: 'f', title: 'Lost in the Loop', narrative: 'n', type: 'failure' } }));
    at();
    expect(await screen.findByText('Failure')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Clues you missed' })).not.toBeInTheDocument();
  });

  it('an unfinished game is not revealed: shows a message and a way back', async () => {
    gameApi.getEnding.mockRejectedValue(apiError('GAME_NOT_FINISHED'));
    at();
    expect(await screen.findByRole('alert')).toHaveTextContent(/still in progress/i);
    expect(screen.getByRole('link', { name: /Back to your game/ })).toHaveAttribute('href', '/game/g1');
  });

  it('Play again starts a fresh game once and navigates to it', async () => {
    gameApi.getEnding.mockResolvedValue(makeEnding());
    const d = deferred();
    gameApi.replayGame.mockReturnValue(d.promise);
    at();
    const btn = await screen.findByRole('button', { name: /Play again/ });
    act(() => { fireEvent.click(btn); fireEvent.click(btn); });
    expect(gameApi.replayGame).toHaveBeenCalledTimes(1);
    d.resolve({ gameId: 'g2' });
    expect(await screen.findByTestId('where')).toHaveTextContent('/game/g2');
  });
});

describe('document titles (WCAG 2.4.2)', () => {
  it('each page sets a distinct, descriptive title', async () => {
    gameApi.listSamples.mockResolvedValue([]);
    renderAt('/', <HomePage />);
    await waitFor(() => expect(document.title).toBe('Break the loop · AI Time-Loop Challenge'));
    cleanup();
    gameApi.listGames.mockResolvedValue({ items: [], total: 0 });
    renderAt('/history', <HistoryPage />);
    await waitFor(() => expect(document.title).toBe('Game history · AI Time-Loop Challenge'));
    cleanup();
    gameApi.getEnding.mockResolvedValue(makeEnding());
    renderAt('/game/g1/ending', <EndingPage />, '/game/:gameId/ending');
    await waitFor(() => expect(document.title).toBe('The Lights Stay On · AI Time-Loop Challenge'));
  });
});
