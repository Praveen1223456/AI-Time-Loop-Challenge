import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * Validated scenario blueprint (spec 10.1). Content is validated by
 * validateBlueprint() BEFORE it is saved; Mixed arrays keep the schema flexible
 * for Phase 3 while the Zod schema remains the real gate.
 * `solutionGuide` is private: never include it in public responses.
 */
const scenarioSchema = new Schema(
  {
    slug: { type: String, index: { unique: true, sparse: true } },
    isSample: { type: Boolean, default: false },
    ownerSessionId: { type: String, default: null, index: true },
    title: { type: String, required: true },
    premise: { type: String, required: true },
    objective: { type: String, required: true },
    theme: { type: String, required: true },
    difficulty: { type: String, required: true },
    initialTime: { type: String, required: true },
    loopEndTime: { type: String, required: true },
    loopLength: { type: Number, required: true },
    maxLoops: { type: Number, required: true },
    startLocationId: { type: String, required: true },
    reset: { type: Schema.Types.Mixed, required: true },
    locations: [Schema.Types.Mixed],
    characters: [Schema.Types.Mixed],
    objects: [Schema.Types.Mixed],
    items: [Schema.Types.Mixed],
    facts: [Schema.Types.Mixed],
    clues: [Schema.Types.Mixed],
    actions: [Schema.Types.Mixed],
    events: [Schema.Types.Mixed],
    winConditions: [Schema.Types.Mixed],
    failureConditions: [Schema.Types.Mixed],
    loopLimitEndingId: { type: String, required: true },
    endings: [Schema.Types.Mixed],
    solutionGuide: { type: Schema.Types.Mixed, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { minimize: false, versionKey: false },
);

export const Scenario = mongoose.models.Scenario ?? mongoose.model('Scenario', scenarioSchema);
