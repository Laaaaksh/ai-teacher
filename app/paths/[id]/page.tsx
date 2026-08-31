import { PathPageClient } from "./PathPageClient";

export default async function PathPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PathPageClient pathId={id} />;
}
