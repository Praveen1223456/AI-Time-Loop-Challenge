const MESSAGES = {
  NETWORK_ERROR: "Can't reach the server. Check your connection and try again.",
  RATE_LIMITED: "You're going a little fast. Wait a moment and try again.",
  AI_NOT_CONFIGURED: "Scenario generation isn't set up on this server yet. Try one of the sample scenarios.",
  GENERATION_IN_PROGRESS: 'A scenario is already being generated. Please wait for it to finish.',
  SCENARIO_GENERATION_FAILED: "The AI couldn't build a playable scenario this time. Try again, or rephrase your idea.",
  AI_TIMEOUT: 'The AI took too long to answer. Please try again.',
  AI_PROVIDER_ERROR: 'The AI service is having trouble right now. Please try again shortly.',
  AI_AUTH_ERROR: 'The AI service is misconfigured on the server.',
  INVALID_ACTION: "That action isn't available right now.",
  INSUFFICIENT_TIME: 'There is not enough time left for that.',
  LOOP_ENDED: 'Time has run out. Start the next loop to continue.',
  GAME_NOT_ACTIVE: 'This game has already ended.',
  GAME_NOT_FINISHED: 'This game is still in progress.',
  STATE_CONFLICT: 'The game changed in another tab. It has been refreshed.',
  FORBIDDEN: 'This game belongs to a different browser session.',
  GAME_NOT_FOUND: 'That game could not be found.',
  SCENARIO_NOT_FOUND: 'That scenario could not be found.',
  NOTES_LIMIT: 'You have reached the maximum number of notes.',
  VALIDATION_ERROR: 'Some of the information was not valid. Please check it and try again.',
};

/** Friendly message for an ApiError (or anything thrown). Never shows raw server internals. */
export function errorMessage(err) {
  return MESSAGES[err?.code] ?? (err?.status >= 500 ? 'Something went wrong on the server.' : (err?.message || 'Something went wrong.'));
}
