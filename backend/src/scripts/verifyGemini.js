import 'dotenv/config';
import * as sdk from '@google/genai';
import { loadEnv } from '../config/env.js';
import { runGeminiVerification } from './verifyGeminiLib.js';

let env;
try { env = loadEnv({ ...process.env, NODE_ENV: process.env.NODE_ENV ?? 'test' }); } // MongoDB is not needed here
catch (e) { console.error(e.message); process.exit(1); }

const customPrompt = process.argv[2];
const { ok } = await runGeminiVerification({ env, sdk, ...(customPrompt ? { prompt: customPrompt } : {}) });
console.log(ok ? '\nGemini integration verified (no data was written to the database).' : '\nVerification FAILED. See the messages above.');
process.exit(ok ? 0 : 1);
