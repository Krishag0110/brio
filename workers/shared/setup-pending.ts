import { createServer } from "node:http";

/** Deployable admission gate while public controller/target URLs are not configured. */
export function createSetupPendingServer(worker: "social" | "verifier") {
  return createServer((request, response) => {
    const health = request.method === "GET" && request.url === "/health";
    response.writeHead(health ? 200 : 503, {
      "content-type": "application/json",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
    response.end(JSON.stringify(health
      ? { status: "setup_pending", ready: false, worker }
      : { error: "worker_setup_pending" }));
  });
}
