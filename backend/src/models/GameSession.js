import mongoose from 'mongoose';

const { Schema } = mongoose;

const eventLogEntrySchema = new Schema(
  {
    loop: { type: Number, required: true },
    turn: Number,
    gameTime: String,
    actionId: { type: String, default: null },
    eventType: { type: String, required: true },
    refId: { type: String, default: null },
    description: { type: String, required: true },
    timestamp: { type: Date, required: true },
  },
  { _id: false },
);

/**
 * Live game state (spec 10.2). Writes go through GameRepository.save(), which uses a
 * compare-and-set on `stateVersion` so conflicting writes cannot silently overwrite each other.
 */
const gameSessionSchema = new Schema(
  {
    scenarioId: { type: Schema.Types.ObjectId, ref: 'Scenario', required: true, index: true },
    sessionId: { type: String, required: true },
    status: { type: String, enum: ['active', 'completed', 'failed'], default: 'active', required: true },
    currentLoop: { type: Number, required: true, min: 1 },
    currentTime: { type: String, required: true },
    currentLocationId: { type: String, required: true },
    turnCount: { type: Number, required: true, min: 0 },
    loopExpired: { type: Boolean, default: false },
    temporaryState: {
      characterLocations: { type: Schema.Types.Mixed, default: {} },
      inventory: { type: [String], default: [] },
      objectStates: { type: Schema.Types.Mixed, default: {} },
      loopFlags: { type: [String], default: [] },
    },
    persistentState: {
      discoveredClueIds: { type: [String], default: [] },
      unlockedActionIds: { type: [String], default: [] },
      unlockedLocationIds: { type: [String], default: [] },
      confirmedFacts: { type: [String], default: [] },
      playerNotes: { type: [String], default: [] },
      persistentItemIds: { type: [String], default: [] },
    },
    hintsUsed: {
      level1: { type: Number, default: 0 },
      level2: { type: Number, default: 0 },
      level3: { type: Number, default: 0 },
    },
    eventLog: { type: [eventLogEntrySchema], default: [] },
    lastRecap: { type: Schema.Types.Mixed, default: null },
    endingId: { type: String, default: null },
    stateVersion: { type: Number, required: true, default: 0 },
    startedAt: { type: Date, required: true },
    updatedAt: { type: Date, required: true },
    completedAt: { type: Date, default: null },
  },
  { minimize: false, versionKey: false },
);

gameSessionSchema.index({ sessionId: 1, updatedAt: -1 });

export const GameSession = mongoose.models.GameSession ?? mongoose.model('GameSession', gameSessionSchema);
