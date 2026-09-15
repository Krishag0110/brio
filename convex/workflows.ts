import { WorkflowManager } from "@convex-dev/workflow";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { Task } from "../src/control/types";
const workflow = new WorkflowManager(components.workflow);
export const runTask = workflow.define({ args: { taskId: v.string() }, returns: v.null() }).handler(async (step, args): Promise<null> => {
  const task: Task | null = await step.runMutation(internal.control.claimTask, args);
  if (!task) return null;
  // Mutations are transactional; side effects explicitly disable automatic retries.
  // Worker callbacks complete asynchronous tasks after lease/attempt/authority checks.
  await step.runAction(internal.execution.execute, { taskId: task.id, attemptId: task.attemptId }, { retry: false });
  return null;
});
