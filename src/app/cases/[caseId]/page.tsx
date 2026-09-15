import { ServerDashboard } from "@/components/control/server-dashboard";
export default async function CasePage({
  params,
}: {
  params: Promise<{ caseId: string }>;
}) {
  const { caseId } = await params;
  return <ServerDashboard caseId={caseId} />;
}
