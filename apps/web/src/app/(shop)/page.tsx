import { Suspense } from "react";
import {
  CategoryRails, CategoryStrip, CategoryStripSkeleton, DealsRail, Hero, NewArrivals, NewArrivalsSkeleton, RailSkeleton,
  SellerBanner, StoresSkeleton, StoresStrip, ValueStrip,
} from "@/components/home-sections";

// Each section streams in on its own, so the shell and hero appear immediately and slow data never blocks the rest.
export default function Home() {
  return (
    <div className="container page home">
      <Hero />
      <ValueStrip />
      <Suspense fallback={<CategoryStripSkeleton />}><CategoryStrip /></Suspense>
      <Suspense fallback={<RailSkeleton title="deals" />}><DealsRail /></Suspense>
      <Suspense fallback={<RailSkeleton />}><CategoryRails limit={3} /></Suspense>
      <Suspense fallback={<StoresSkeleton />}><StoresStrip /></Suspense>
      <Suspense fallback={<NewArrivalsSkeleton />}><NewArrivals /></Suspense>
      <SellerBanner />
    </div>
  );
}
