import { z } from "zod";
import { encryptedSessionSchema } from "./contracts";

export const normalizeRedditAccount = (value: string) => value.replace(/^\/?u\//i, "").toLowerCase();
export const redditAccountSchema = z.string().transform(normalizeRedditAccount).pipe(z.string().regex(/^[a-z0-9_-]{3,20}$/));
export const redditCommunitiesSchema = z.array(z.string().regex(/^[A-Za-z0-9_]{2,21}$/).transform(value => value.toLowerCase())).min(1).max(5)
  .refine(values => new Set(values).size === values.length, "duplicate_community");
export const redditCredentialSchema = z.object({
  refreshToken: z.string().min(1).max(4096), clientId: z.string().min(1).max(200),
  allowedSubreddits: redditCommunitiesSchema,
}).strict();
export type RedditCredential = z.infer<typeof redditCredentialSchema>;
export const encryptedRedditCredentialSchema = encryptedSessionSchema.extend({ purpose: z.literal("reddit_oauth") }).strict();
export type EncryptedRedditCredential = z.infer<typeof encryptedRedditCredentialSchema>;
export const redditIngestionSchema = z.object({
  mode: z.literal("live"), cursorCommitRequired: z.literal(true), nextCursor: z.string().regex(/^\d{1,16}$/),
  items: z.array(z.object({
    platform: z.literal("reddit"), sourceMode: z.literal("live"), externalId: z.string().regex(/^t[13]_[a-z0-9]+$/),
    originalUrl: z.string().url(), author: redditAccountSchema, text: z.string().min(1).max(20_000),
    subreddit: z.string().regex(/^[A-Za-z0-9_]{2,21}$/), observedAt: z.number().int().nonnegative(),
  }).strict()).max(20),
}).strict();
