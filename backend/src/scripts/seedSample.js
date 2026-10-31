import 'dotenv/config';
import { loadEnv } from '../config/env.js';
import { connectDb, disconnectDb } from '../config/db.js';
import { createMongoRepositories } from '../repositories/mongoRepositories.js';
import { validateBlueprint } from '../services/blueprintValidator.js';
import { solvabilityIssues } from '../services/solvabilityService.js';
import { sampleScenario } from '../data/sampleScenario.js';

const env = loadEnv();
const blueprint = validateBlueprint(sampleScenario); // refuse to store an invalid blueprint
const { issues } = await solvabilityIssues(blueprint);
if (issues.length) throw new Error(`Sample scenario is not solvable: ${issues.join('; ')}`);
await connectDb(env.MONGODB_URI);
try {
  const saved = await createMongoRepositories().scenarios.upsertBySlug(blueprint, { isSample: true });
  console.log(`Sample scenario "${saved.title}" stored with id ${saved.id}`);
} finally {
  await disconnectDb();
}
