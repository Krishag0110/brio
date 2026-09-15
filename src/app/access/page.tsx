import Link from "next/link";
import { AccessForm } from "@/components/control/access-form";

export const dynamic = "force-dynamic";

export default function AccessPage() {
  const demo = process.env.FDE_DEMO_MODE === "true";
  return (
    <main id="main-content" className="sign-in">
      <h1>Workspace access</h1>
      <section className="panel">
        {demo ? (
          <>
            <h2>Local demo opens without a login</h2>
            <p>
              Demo identities simulate roles. Live Build, Go, reply, and policy
              approvals remain in Slack.
            </p>
            <Link href="/">Open local workspace</Link>
          </>
        ) : (
          <>
            <p>
              Use the shared hackathon access code for this hosted workspace.
              Local loopback access opens directly.
            </p>
            <AccessForm />
            <p className="small muted">
              Workspace access does not grant a Slack approval. Live decisions
              require the configured Slack role.
            </p>
          </>
        )}
      </section>
    </main>
  );
}
