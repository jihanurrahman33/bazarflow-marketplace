import { Skeleton } from "@/components/ui";

export default function Loading() {
  return (
    <div className="container page stack" role="status" aria-live="polite">
      <Skeleton h={28} w="50%" />
      <Skeleton h={44} />
      <Skeleton h={44} />
    </div>
  );
}
