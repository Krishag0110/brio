import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";
const crons = cronJobs();
crons.interval("expire abandoned worker attempts", { minutes: 2 }, internal.control.expireLeases, {});
crons.interval("approval reminders and configured intake", { minutes: 1 }, internal.control.maintain, {});
export default crons;
