import 'dotenv/config';
import { loadEnv, EnvValidationError } from './config/env.js';
import { connectDb, disconnectDb, getDbStatus } from './config/db.js';
import { createApp } from './app.js';
import { createMongoRepositories } from './repositories/mongoRepositories.js';
import { createGeminiClient } from './services/geminiClient.js';

let env;
try {
  env = loadEnv();
} catch (err) {
  if (err instanceof EnvValidationError) {
    console.error(err.message);
    process.exit(1);
  }
  throw err;
}

try {
  await connectDb(env.MONGODB_URI);
} catch (err) {
  const safe = String(err.message).replaceAll(env.MONGODB_URI, '<redacted>');
  console.error(`MongoDB connection failed: ${safe}`);
  process.exit(1);
}

// Gemini is optional at start-up: without a key + model the sample scenario still plays and
// POST /scenarios answers 503 AI_NOT_CONFIGURED. The key never leaves the backend.
let ai;
if (env.GEMINI_API_KEY && env.GEMINI_MODEL) {
  const sdk = await import('@google/genai');
  ai = createGeminiClient({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL, sdk });
  console.log(`Gemini scenario generation enabled (model: ${env.GEMINI_MODEL})`);
} else {
  console.warn('Gemini scenario generation disabled: set GEMINI_API_KEY and GEMINI_MODEL to enable it.');
}

const app = createApp({ env, repositories: createMongoRepositories(), getDbStatus, ai });
const server = app.listen(env.PORT, () => {
  console.log(`API listening on port ${env.PORT} (${env.NODE_ENV}); database: ${getDbStatus()}`);
});

async function shutdown(signal) {
  console.log(`${signal} received, shutting down`);
  server.close(async () => {
    await disconnectDb();
    process.exit(0);
  });
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
