import type { SVGProps } from "react";

/** Small inline icon set (stroke icons, currentColor). Decorative by default: pair with visible text or an aria-label. */
function Svg(props: SVGProps<SVGSVGElement> & { children: React.ReactNode }) {
  const { children, ...rest } = props;
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...rest}>{children}</svg>;
}
export const IconSearch = (p: SVGProps<SVGSVGElement>) => <Svg {...p}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></Svg>;
export const IconCart = (p: SVGProps<SVGSVGElement>) => <Svg {...p}><path d="M3 4h2l2.4 11.2a1 1 0 0 0 1 .8h8.9a1 1 0 0 0 1-.8L20 8H6.2" /><circle cx="9.5" cy="20" r="1.3" /><circle cx="17" cy="20" r="1.3" /></Svg>;
export const IconUser = (p: SVGProps<SVGSVGElement>) => <Svg {...p}><circle cx="12" cy="8" r="4" /><path d="M4 21c1.2-4 4.2-6 8-6s6.8 2 8 6" /></Svg>;
export const IconMenu = (p: SVGProps<SVGSVGElement>) => <Svg {...p}><path d="M4 6h16M4 12h16M4 18h16" /></Svg>;
export const IconClose = (p: SVGProps<SVGSVGElement>) => <Svg {...p}><path d="M6 6l12 12M18 6 6 18" /></Svg>;
export const IconChevronDown = (p: SVGProps<SVGSVGElement>) => <Svg {...p}><path d="m6 9 6 6 6-6" /></Svg>;
export const IconChevronLeft = (p: SVGProps<SVGSVGElement>) => <Svg {...p}><path d="m15 6-6 6 6 6" /></Svg>;
export const IconChevronRight = (p: SVGProps<SVGSVGElement>) => <Svg {...p}><path d="m9 6 6 6-6 6" /></Svg>;
export const IconShield = (p: SVGProps<SVGSVGElement>) => <Svg {...p}><path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6l-7-3Z" /><path d="m9 12 2 2 4-4" /></Svg>;
export const IconReturn = (p: SVGProps<SVGSVGElement>) => <Svg {...p}><path d="M4 9h11a5 5 0 0 1 0 10H8" /><path d="m8 5-4 4 4 4" /></Svg>;
export const IconTruck = (p: SVGProps<SVGSVGElement>) => <Svg {...p}><path d="M2 6h11v10H2zM13 9h4l3 3v4h-7" /><circle cx="7" cy="18" r="1.6" /><circle cx="17" cy="18" r="1.6" /></Svg>;
export const IconStore = (p: SVGProps<SVGSVGElement>) => <Svg {...p}><path d="M4 9 5.5 4h13L20 9M4 9v11h16V9M4 9c0 1.7 1.3 3 3 3s3-1.3 3-3c0 1.7 1.3 3 3 3s3-1.3 3-3c0 1.7 1.3 3 3 3" /></Svg>;
export const IconHeadset = (p: SVGProps<SVGSVGElement>) => <Svg {...p}><path d="M4 14v-2a8 8 0 0 1 16 0v2" /><rect x="3" y="14" width="4" height="6" rx="1.5" /><rect x="17" y="14" width="4" height="6" rx="1.5" /></Svg>;
export const IconHome = (p: SVGProps<SVGSVGElement>) => <Svg {...p}><path d="M4 11 12 4l8 7v9H4z" /><path d="M10 20v-6h4v6" /></Svg>;
export const IconGrid = (p: SVGProps<SVGSVGElement>) => <Svg {...p}><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></Svg>;
export const IconImage = (p: SVGProps<SVGSVGElement>) => <Svg {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="m21 16-5-5-8 8" /></Svg>;
export const IconFilter = (p: SVGProps<SVGSVGElement>) => <Svg {...p}><path d="M4 6h16M7 12h10M10 18h4" /></Svg>;
