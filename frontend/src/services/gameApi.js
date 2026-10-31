/** All game/scenario HTTP calls. Components never call fetch directly. */
import { apiRequest } from './api.js';

const data = async (promise) => (await promise).data;
const post = (path, body, options = {}) => apiRequest(path, { method: 'POST', body: body ?? {}, ...options });

export const listSamples = (options) => data(apiRequest('/scenarios/samples', options));
export const createScenario = (form, options) => data(post('/scenarios', form, options));
export const startGame = (scenarioId, options) => data(post('/games', { scenarioId }, options));
export const getGame = (gameId, options) => data(apiRequest(`/games/${gameId}`, options));
export const listGames = ({ limit = 20, skip = 0 } = {}, options) => data(apiRequest(`/games?limit=${limit}&skip=${skip}`, options));
export const performAction = (gameId, body, options) => data(post(`/games/${gameId}/actions`, body, options));
export const resetLoop = (gameId, body, options) => data(post(`/games/${gameId}/reset`, body, options));
export const requestHint = (gameId, level, options) => data(post(`/games/${gameId}/hints`, { level }, options));
export const addNote = (gameId, body, options) => data(post(`/games/${gameId}/notes`, body, options));
export const getEnding = (gameId, options) => data(apiRequest(`/games/${gameId}/ending`, options));
export const replayGame = (gameId, options) => data(post(`/games/${gameId}/replay`, {}, options));
