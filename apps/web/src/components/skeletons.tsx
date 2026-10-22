import { ProductCardSkeleton } from "./product-card";
import { RailSkeleton } from "./product-rail";
import { Skeleton } from "./ui";

/** Route-level skeleton screens, shaped like the pages they stand in for (used by loading.tsx files). */
const Busy = ({ children, label }: { children: React.ReactNode; label: string }) => (
  <div className="container page skel-page" role="status" aria-live="polite" aria-busy="true"><span className="sr-only">{label}</span>{children}</div>
);

/** Just the result area (filters + grid): used inside pages that already know the route exists. */
export const ListingBodySkeleton = () => (
  <div className="listing" role="status" aria-busy="true"><span className="sr-only">Loading products</span>
    <div className="listing-filters filters-desktop"><Skeleton h={260} /></div>
    <div className="stack listing-main">
      <Skeleton h={52} />
      <div className="grid grid-products">{Array.from({ length: 12 }, (_, i) => <ProductCardSkeleton key={i} />)}</div>
    </div>
  </div>
);

export const ListingSkeleton = () => (
  <Busy label="Loading products">
    <Skeleton h={28} w="30%" />
    <div className="listing">
      <div className="listing-filters filters-desktop"><Skeleton h={260} /></div>
      <div className="stack listing-main">
        <Skeleton h={52} />
        <div className="grid grid-products">{Array.from({ length: 12 }, (_, i) => <ProductCardSkeleton key={i} />)}</div>
      </div>
    </div>
  </Busy>
);

export const ProductSkeleton = () => (
  <Busy label="Loading product">
    <Skeleton h={14} w="35%" />
    <div className="skel-split">
      <Skeleton h={480} />
      <div className="skel-lines"><Skeleton h={32} w="85%" /><Skeleton h={18} w="40%" /><Skeleton h={40} w="35%" /><Skeleton h={44} w="60%" /><Skeleton h={46} w="50%" /><Skeleton h={120} /></div>
    </div>
    <RailSkeleton />
  </Busy>
);

export const ListPageSkeleton = ({ label = "Loading" }: { label?: string }) => (
  <Busy label={label}>
    <Skeleton h={32} w="28%" />
    {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} h={88} />)}
  </Busy>
);

export const FormPageSkeleton = () => (
  <Busy label="Loading form">
    <Skeleton h={32} w="40%" />
    <div className="skel-lines" style={{ maxWidth: 480 }}><Skeleton h={44} /><Skeleton h={44} /><Skeleton h={44} /><Skeleton h={46} w="40%" /></div>
  </Busy>
);
