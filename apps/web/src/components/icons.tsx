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
export const IconBox = (p: SVGProps<SVGSVGElement>) => <Svg {...p}><path d="m3 7.5 9-4.5 9 4.5v9L12 21l-9-4.5z" /><path d="m3 7.5 9 4.5 9-4.5M12 12v9" /></Svg>;
export const IconReceipt = (p: SVGProps<SVGSVGElement>) => <Svg {...p}><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h6" /></Svg>;
export const IconCoin = (p: SVGProps<SVGSVGElement>) => <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M14.5 9.2c-.4-.8-1.4-1.2-2.5-1.2-1.4 0-2.5.7-2.5 1.8 0 2.5 5 1.2 5 3.7 0 1.1-1.1 1.8-2.5 1.8-1.2 0-2.2-.5-2.6-1.4M12 6.5V8m0 8v1.5" /></Svg>;
export const IconChart = (p: SVGProps<SVGSVGElement>) => <Svg {...p}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></Svg>;
export const IconUsers = (p: SVGProps<SVGSVGElement>) => <Svg {...p}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.4 3.2-5 6.5-5s5.7 1.6 6.5 5" /><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 15.2c2 .6 3.2 2.1 3.7 4.8" /></Svg>;
export const IconSettings = (p: SVGProps<SVGSVGElement>) => <Svg {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 14a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></Svg>;
export const IconAlert = (p: SVGProps<SVGSVGElement>) => <Svg {...p}><path d="M12 3 2 20h20z" /><path d="M12 10v4M12 17.5v.01" /></Svg>;
export const IconList = (p: SVGProps<SVGSVGElement>) => <Svg {...p}><path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" /></Svg>;
export const IconTag = (p: SVGProps<SVGSVGElement>) => <Svg {...p}><path d="M3 12V3h9l9 9-9 9z" /><circle cx="7.5" cy="7.5" r="1.3" /></Svg>;
export const IconCheck = (p: SVGProps<SVGSVGElement>) => <Svg {...p}><path d="m4 12 5 5L20 6" /></Svg>;
export const IconRefund = (p: SVGProps<SVGSVGElement>) => <Svg {...p}><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></Svg>;
export const IconCard = (p: SVGProps<SVGSVGElement>) => <Svg {...p}><rect x="2.5" y="5" width="19" height="14" rx="2.5" /><path d="M2.5 10h19M6 15h4" /></Svg>;
export const IconShieldLock = (p: SVGProps<SVGSVGElement>) => <Svg {...p}><path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6z" /><rect x="9" y="11" width="6" height="5" rx="1" /></Svg>;
export const IconExternal = (p: SVGProps<SVGSVGElement>) => <Svg {...p}><path d="M14 4h6v6M20 4 10 14M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></Svg>;
export const IconHeart = (p: SVGProps<SVGSVGElement>) => <Svg {...p}><path d="M12 20.5s-7.5-4.6-9.2-9.3C1.7 8 3.6 5 6.8 5c2 0 3.8 1.1 5.2 3 1.4-1.9 3.2-3 5.2-3 3.2 0 5.1 3 4 6.2-1.7 4.7-9.2 9.3-9.2 9.3Z" /></Svg>;
