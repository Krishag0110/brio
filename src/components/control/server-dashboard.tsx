import { requireControlAccess } from "@/server/access";
import { Dashboard } from "./dashboard";
import type { Tab } from "./types";

/** Every workspace page and API enforce the workspace access boundary separately. */
export async function ServerDashboard({
  tab,
  caseId,
}: {
  tab?: Tab;
  caseId?: string;
}) {
  await requireControlAccess();
  return <Dashboard tab={tab} caseId={caseId} />;
}
