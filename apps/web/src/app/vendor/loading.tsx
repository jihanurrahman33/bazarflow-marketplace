import { ListSkeleton, Skeleton } from "@/components/ui";

export default function Loading() {
  return (
    <div className="container page stack" role="status" aria-live="polite">
      <Skeleton h={32} w="30%" />
      <ListSkeleton rows={5} />
    </div>
  );
}
