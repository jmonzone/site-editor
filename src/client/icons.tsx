import type { ReactNode } from "react";

/** Small stroke icons, inlined so the editor doesn't depend on an icon library version. */
function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const UpIcon = () => <Icon><path d="M12 19V5M5 12l7-7 7 7" /></Icon>;
export const DownIcon = () => <Icon><path d="M12 5v14M19 12l-7 7-7-7" /></Icon>;
export const CopyIcon = () => (
  <Icon>
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15V5a2 2 0 0 1 2-2h10" />
  </Icon>
);
export const PlusIcon = () => <Icon><path d="M12 5v14M5 12h14" /></Icon>;
export const TrashIcon = () => (
  <Icon>
    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" />
  </Icon>
);
export const UndoIcon = () => <Icon><path d="M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-4" /></Icon>;
export const RedoIcon = () => <Icon><path d="m15 14 5-5-5-5M20 9H9a5 5 0 0 0 0 10h4" /></Icon>;
export const BackIcon = () => <Icon><path d="M15 18l-6-6 6-6" /></Icon>;
export const CloseIcon = () => <Icon><path d="M18 6 6 18M6 6l12 12" /></Icon>;
export const ExternalIcon = () => <Icon><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></Icon>;
export const HistoryIcon = () => <Icon><path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2" /></Icon>;
export const SettingsIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
  </Icon>
);
export const DesktopIcon = () => (
  <Icon>
    <rect x="2" y="4" width="20" height="13" rx="2" />
    <path d="M8 21h8M12 17v4" />
  </Icon>
);
export const TabletIcon = () => (
  <Icon>
    <rect x="5" y="2" width="14" height="20" rx="2" />
    <path d="M11 18h2" />
  </Icon>
);
export const PhoneIcon = () => (
  <Icon>
    <rect x="7" y="2" width="10" height="20" rx="2" />
    <path d="M11 18h2" />
  </Icon>
);
export const UploadIcon = () => <Icon><path d="M12 15V3M7 8l5-5 5 5M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" /></Icon>;
export const ChevronIcon = () => <Icon><path d="m9 18 6-6-6-6" /></Icon>;
export const CameraIcon = () => (
  <Icon>
    <path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" />
    <circle cx="12" cy="13.5" r="3.5" />
  </Icon>
);
