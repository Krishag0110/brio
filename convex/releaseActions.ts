"use node";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { executeEngineering } from "../src/integrations/engineering";
import type { ControlState } from "../src/control/types";

export const execute = internalAction({ args: { taskId: v.string(), attemptId: v.string() }, handler: async (ctx, args): Promise<Record<string, unknown>> => {
  const state: ControlState = await ctx.runQuery(internal.control.stateForAction, {});
  const task = state.tasks.find(item => item.id === args.taskId && item.attemptId === args.attemptId);
  if (!task) throw new Error("stale_engineering_task");
  return executeEngineering(ctx, task, state);
} });
