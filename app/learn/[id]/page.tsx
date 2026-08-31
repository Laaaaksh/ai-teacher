import { LearnPageClient } from "./LearnPageClient";

export default async function LearnPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <LearnPageClient sessionId={id} />;
}
