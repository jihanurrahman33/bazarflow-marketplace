import { Suspense } from "react";
import {
  CategoryRails, CategoryTiles, CategoryTilesSkeleton, DealsRail, DepartmentNav, Hero, NewArrivals,
  NewArrivalsSkeleton, RailSkeleton, SellerBanner, StoresSkeleton, StoresStrip, TrustBar,
} from "@/components/home-sections";

// Each section streams in on its own, so the page shell and hero appear immediately and slow data never blocks the rest.
export default function Home() {
  return (
    <div className="container page stack-lg">
      <Hero />
      <DepartmentNav />
      <TrustBar />
      <Suspense fallback={<CategoryTilesSkeleton />}><CategoryTiles /></Suspense>
      <Suspense fallback={<RailSkeleton title="deals" />}><DealsRail /></Suspense>
      <Suspense fallback={<RailSkeleton />}><CategoryRails limit={4} /></Suspense>
      <Suspense fallback={<StoresSkeleton />}><StoresStrip /></Suspense>
      <SellerBanner />
      <Suspense fallback={<NewArrivalsSkeleton />}><NewArrivals /></Suspense>
    </div>
  );
}
