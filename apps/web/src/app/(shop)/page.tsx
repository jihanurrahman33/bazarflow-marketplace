import { Suspense } from "react";
import { PersonalRails } from "@/components/personal-rails";
import {
  CategoryRails, CategoryStrip, CategoryStripSkeleton, DealsRail, Hero, NewArrivals, NewArrivalsSkeleton, RailSkeleton,
  MoreCategoryRails, SellerBanner, StoresSkeleton, StoresStrip, TopRatedRail, TrendingRail, ValueStrip,
} from "@/components/home-sections";

// Each section streams in on its own, so the shell and hero appear immediately and slow data never blocks the rest.
export default function Home() {
  return (
    <div className="container page home">
      <Hero />
      <ValueStrip />
      <Suspense fallback={<CategoryStripSkeleton />}><CategoryStrip /></Suspense>
      <PersonalRails />
      <Suspense fallback={<RailSkeleton title="deals" />}><DealsRail /></Suspense>
      <Suspense fallback={null}><TrendingRail /></Suspense>
      <Suspense fallback={null}><TopRatedRail /></Suspense>
      <Suspense fallback={<RailSkeleton />}><CategoryRails limit={3} /></Suspense>
      <Suspense fallback={null}><MoreCategoryRails skip={3} /></Suspense>
      <Suspense fallback={<StoresSkeleton />}><StoresStrip /></Suspense>
      <Suspense fallback={<NewArrivalsSkeleton />}><NewArrivals /></Suspense>
      <SellerBanner />
    </div>
  );
}
