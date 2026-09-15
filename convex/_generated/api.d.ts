/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agents from "../agents.js";
import type * as control from "../control.js";
import type * as controlActions from "../controlActions.js";
import type * as crons from "../crons.js";
import type * as demoControl from "../demoControl.js";
import type * as execution from "../execution.js";
import type * as http from "../http.js";
import type * as redditControl from "../redditControl.js";
import type * as releaseActions from "../releaseActions.js";
import type * as releaseControl from "../releaseControl.js";
import type * as sessionActions from "../sessionActions.js";
import type * as snapshotValidator from "../snapshotValidator.js";
import type * as state from "../state.js";
import type * as workerControl from "../workerControl.js";
import type * as workflows from "../workflows.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  agents: typeof agents;
  control: typeof control;
  controlActions: typeof controlActions;
  crons: typeof crons;
  demoControl: typeof demoControl;
  execution: typeof execution;
  http: typeof http;
  redditControl: typeof redditControl;
  releaseActions: typeof releaseActions;
  releaseControl: typeof releaseControl;
  sessionActions: typeof sessionActions;
  snapshotValidator: typeof snapshotValidator;
  state: typeof state;
  workerControl: typeof workerControl;
  workflows: typeof workflows;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  agent: import("@convex-dev/agent/_generated/component.js").ComponentApi<"agent">;
  workflow: import("@convex-dev/workflow/_generated/component.js").ComponentApi<"workflow">;
};
