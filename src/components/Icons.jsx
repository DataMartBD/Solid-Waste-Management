// Minimal inline SVG icon set (stroke-based, inherits color via currentColor)
const S = ({ children, size = 18, ...p }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" {...p}>{children}</svg>
)

export const IconDashboard = (p) => <S {...p}><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></S>
export const IconHome = (p) => <S {...p}><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5"/><path d="M9.5 21v-6h5v6"/></S>
export const IconMap = (p) => <S {...p}><path d="m9 4-6 2v14l6-2 6 2 6-2V4l-6 2-6-2Z"/><path d="M9 4v14M15 6v14"/></S>
export const IconTruck = (p) => <S {...p}><path d="M3 6h11v9H3z"/><path d="M14 9h4l3 3v3h-7z"/><circle cx="7" cy="18" r="1.8"/><circle cx="17" cy="18" r="1.8"/></S>
export const IconUsers = (p) => <S {...p}><circle cx="9" cy="8" r="3.2"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0"/><path d="M16 5.2a3.2 3.2 0 0 1 0 5.6M18 20a5.5 5.5 0 0 0-3-4.9"/></S>
export const IconAlert = (p) => <S {...p}><path d="M12 3 2.5 20h19L12 3Z"/><path d="M12 10v4M12 17.5v.01"/></S>
export const IconBill = (p) => <S {...p}><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z"/><path d="M9 8h6M9 12h6"/></S>
export const IconChart = (p) => <S {...p}><path d="M4 20V4"/><path d="M4 20h16"/><rect x="7" y="12" width="3" height="5"/><rect x="12" y="8" width="3" height="9"/><rect x="17" y="5" width="3" height="12"/></S>
export const IconRoute = (p) => <S {...p}><circle cx="6" cy="19" r="2.2"/><circle cx="18" cy="5" r="2.2"/><path d="M8 19h6a4 4 0 0 0 0-8H10a4 4 0 0 1 0-8h6"/></S>
export const IconWrench = (p) => <S {...p}><path d="M15 4a5 5 0 0 0-4.6 7l-6 6a2 2 0 0 0 3 3l6-6A5 5 0 1 0 15 4Z"/></S>
export const IconPhone = (p) => <S {...p}><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L20 13l2 5v3a1 1 0 0 1-1 1A17 17 0 0 1 4 5a1 1 0 0 1 1-1Z"/></S>
export const IconLogout = (p) => <S {...p}><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 12H3M6 8l-4 4 4 4"/></S>
export const IconSearch = (p) => <S {...p}><circle cx="11" cy="11" r="7"/><path d="m21 21-4-4"/></S>
export const IconBell = (p) => <S {...p}><path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z"/><path d="M10 19a2 2 0 0 0 4 0"/></S>
export const IconQr = (p) => <S {...p}><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3M20 14v.01M14 20h.01M17 20h3v-3"/></S>
export const IconCheck = (p) => <S {...p}><path d="M20 6 9 17l-5-5"/></S>
export const IconClock = (p) => <S {...p}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></S>
export const IconFuel = (p) => <S {...p}><rect x="4" y="4" width="9" height="16" rx="1.5"/><path d="M13 9h3l2 2v6a2 2 0 0 1-4 0v-3"/><path d="M6 8h5"/></S>
export const IconPlus = (p) => <S {...p}><path d="M12 5v14M5 12h14"/></S>
export const IconArrow = (p) => <S {...p}><path d="M5 12h14M13 6l6 6-6 6"/></S>
export const IconEdit = (p) => <S {...p}><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z"/></S>
export const IconTrash = (p) => <S {...p}><path d="M4 7h16M9 7V4h6v3M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/></S>
export const IconEye = (p) => <S {...p}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></S>
export const IconDownload = (p) => <S {...p}><path d="M12 3v12M8 11l4 4 4-4"/><path d="M4 19h16"/></S>
export const IconSun = (p) => <S {...p}><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19"/></S>
export const IconMoon = (p) => <S {...p}><path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.6 6.6 0 0 0 9.8 9.8Z"/></S>
export const IconSpark = (p) => <S {...p}><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z"/></S>
export const IconExpand = (p) => <S {...p}><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/></S>
export const IconMinimize = (p) => <S {...p}><path d="M3 8h5V3M21 8h-5V3M3 16h5v5M21 16h-5v5"/></S>
