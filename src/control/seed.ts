import type { ControlState, RuntimeConfig } from "./types";
import type { Persona } from "../shared/control-contract";
import { FICTIONAL_SOLVED_ISSUES } from "../core/signals";

export const seedPersonas: Persona[] = [
  {
    id: "friendly", name: "Friendly Internet Brand", version: 1, status: "draft",
    objective: "community engagement", brandDescription: "A weather app that listens and fixes real problems.",
    audience: "People who enjoy useful forecasts and friendly internet humor.", formality: 1, warmth: 4,
    directness: 4, slang: 4, humorLevel: 3, roastLevel: 1, maxLength: 240, maxEmoji: 1,
    allowedCategories: ["friendly_banter", "praise", "harmless_joke", "mild_repetition"],
    doNotEngage: ["scams", "floods", "sensitive complaints", "opt-outs"], bannedPhrases: [],
    hourlyCap: 10, dailyCap: 30, authorCooldownHours: 24, platforms: ["x", "reddit"], autonomyEnabled: true,
    approvedVocabulary: ["bruh"], examples: ["bruh 😭", "Finally, a forecast we can agree on."],
    counterexamples: ["Making fun of someone who lost money is never the strategy."],
  },
  {
    id: "support", name: "Clear Support", version: 1, status: "draft",
    objective: "customer trust", brandDescription: "Accurate weather information and accountable support.",
    audience: "Customers seeking clear product help.", formality: 4, warmth: 4, directness: 5,
    slang: 0, humorLevel: 0, roastLevel: 0, maxLength: 240, maxEmoji: 0,
    allowedCategories: ["praise", "friendly_banter"], doNotEngage: ["scams", "sensitive contexts"], bannedPhrases: [],
    hourlyCap: 10, dailyCap: 30, authorCooldownHours: 24, platforms: ["x", "reddit"], autonomyEnabled: false,
  },
  {
    id: "challenger", name: "Playful Challenger", version: 1, status: "draft",
    objective: "playful brand awareness", brandDescription: "Weather with personality; support with accountability.",
    audience: "An internet-native community that enjoys light banter.", formality: 0, warmth: 3,
    directness: 4, slang: 4, humorLevel: 4, roastLevel: 2, maxLength: 240, maxEmoji: 1,
    allowedCategories: ["friendly_banter", "praise", "harmless_joke", "mild_repetition", "light_roast"],
    doNotEngage: ["scams", "floods", "personal attacks", "real complaints"], bannedPhrases: [],
    hourlyCap: 10, dailyCap: 30, authorCooldownHours: 24, platforms: ["x", "reddit"], autonomyEnabled: true,
  },
];
export function initialState(config: RuntimeConfig): ControlState {
  const infrastructureCommittedUsd = config.infrastructureCommittedUsd ?? 0;
  if (!Number.isFinite(infrastructureCommittedUsd) || infrastructureCommittedUsd < 0 || infrastructureCommittedUsd > 100) throw new Error("configuration_required:valid_infrastructure_commitment");
  return {
    schemaVersion: 1, workspaceId: "fde", version: 1, sequence: 0, paused: false, mode: config.mode,
    model: "gpt-5-mini", demoRole: "marketer", cases: [], personas: structuredClone(seedPersonas),
    connections: [
      { id: "x", platform: "x", status: "access_pending", detail: "Experimental browser adapter. Account and platform permissions are not verified.", version: 1, paused: false, permission: "unverified" },
      { id: "reddit", platform: "reddit", status: "access_pending", detail: "Official API approval and community permission required.", version: 1, paused: false, permission: "unverified" },
    ], authorities: [], tasks: [], audit: [], suppressions: [], costs: [], infrastructureCommittedUsd,
    solvedIssues: structuredClone([...FICTIONAL_SOLVED_ISSUES]), sourceKeys: [],
  };
}
