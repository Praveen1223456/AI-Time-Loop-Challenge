// TEST-ONLY fixtures shaped like the backend's public state. Never imported by product code.
export const makeState = (over = {}) => ({
  gameId: 'g1',
  scenario: { id: 's1', title: 'Nine Minutes to Darkness', premise: 'p', objective: 'Stop the blackout.' },
  status: 'active', stateVersion: 0,
  loop: { current: 1, max: 5 },
  time: { current: '20:45', end: '21:00', length: 15, remainingMinutes: 15, expired: false },
  turnCount: 0,
  location: { id: 'control_room', name: 'Control Room', description: 'Dim monitors hum.' },
  accessibleLocations: [{ id: 'control_room', name: 'Control Room' }, { id: 'engineering_bay', name: 'Engineering Bay' }],
  charactersHere: [{ id: 'okoye', name: 'Director Imani Okoye', role: 'Station director', publicFacts: ['Runs the station by the book.'] }],
  availableActions: [
    { id: 'inspect_control_panel', type: 'inspect', label: 'Inspect the control panel', timeCost: 1, affordable: true },
    { id: 'talk_director', type: 'talk', label: 'Talk to Director Okoye', timeCost: 2, targetId: 'okoye', affordable: true },
    { id: 'go_control_to_engineering', type: 'travel', label: 'Go to the Engineering Bay', timeCost: 2, affordable: true },
    { id: 'wait_one_minute', type: 'wait', label: 'Wait one minute', timeCost: 1, affordable: true },
  ],
  inventory: [],
  journal: { clues: [], confirmedFacts: [], playerNotes: [] },
  recentEvents: [],
  hints: { used: { 1: 0, 2: 0, 3: 0 }, available: true },
  recap: null, endingId: null,
  ...over,
});

export const makeEnding = (over = {}) => ({
  scenarioId: 's1',
  summary: 'You broke the loop in 3 loops, discovering 3 of 6 lasting clues and using 0 hints.',
  hintsUsed: { level1: 0, level2: 0, level3: 0, total: 0 },
  decisions: [{ gameTime: '20:45', description: 'Go to the Engineering Bay' }],
  ending: { id: 'e', title: 'The Lights Stay On', narrative: 'Relay R-7 cools.', type: 'victory' },
  objectiveCompleted: true, loopsPlayed: 3,
  keyCluesDiscovered: [{ id: 'c1', title: 'The silenced alarm', description: 'Silenced at 20:41.' }],
  missedClues: [{ id: 'c2', title: 'Scorched relay', description: 'Warm to the touch.' }],
  causalChain: ['A patch disabled the cutoff.', 'R-7 tripped.'],
  timeline: [{ loop: 1, gameTime: '20:46', eventType: 'clue_discovered', description: 'Discovered clue: The silenced alarm' }],
  ...over,
});

export const apiError = (code, message = 'x', status = 409) => Object.assign(new Error(message), { name: 'ApiError', code, status });
