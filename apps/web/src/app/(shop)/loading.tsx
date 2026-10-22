import { GridSkeleton, Skeleton } from "@/components/ui";

/** Shown by Next while a server-rendered storefront page is being prepared. */
export default function Loading() {
  return (
    <div className="container page stack" role="status" aria-live="polite">
      <Skeleton h={32} w="40%" />
      <GridSkeleton count={8} />
    </div>
  );
}
