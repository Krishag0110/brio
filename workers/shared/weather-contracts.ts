import { z } from "zod";
export const provenanceSchema = z.object({ schemaVersion: z.literal(1), runId: z.string(), candidateId: z.string(), headSha: z.string(), treeDigest: z.string(), trustedTestRevision: z.string(), buildConfigRevision: z.string(), mode: z.enum(["fixture", "live"]) }).strict();
export type Provenance = z.infer<typeof provenanceSchema>;
