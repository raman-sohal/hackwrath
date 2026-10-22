import type { JSX } from 'react'

type Props = { size?: number; className?: string }

const base = (size: number): JSX.IntrinsicElements['svg'] => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true
})

export const WaveIcon = ({ size = 22, className }: Props): JSX.Element => (
  <svg {...base(size)} className={className}>
    <path d="M3 12h2l2-6 3 13 3-16 3 13 2-4h3" />
  </svg>
)

export const CaptionsIcon = ({ size = 20, className }: Props): JSX.Element => (
  <svg {...base(size)} className={className}>
    <rect x="3" y="5" width="18" height="14" rx="3" />
    <path d="M7 12h3M13 12h4M7 15h2M11 15h6" />
  </svg>
)

export const HandIcon = ({ size = 20, className }: Props): JSX.Element => (
  <svg {...base(size)} className={className}>
    <path d="M7.5 12.5V7a1.5 1.5 0 0 1 3 0v5M10.5 12V5.5a1.5 1.5 0 0 1 3 0V12M13.5 12V6.5a1.5 1.5 0 0 1 3 0V13" />
    <path d="M16.5 9.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-1.2a6 6 0 0 1-4.5-2.1L4.1 15.5a1.6 1.6 0 0 1 2.5-2l.9 1" />
  </svg>
)

export const CameraIcon = ({ size = 20, className }: Props): JSX.Element => (
  <svg {...base(size)} className={className}>
    <path d="M3 8a2 2 0 0 1 2-2h2l1.5-2h7L17 6h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8Z" />
    <circle cx="12" cy="12.5" r="3.4" />
  </svg>
)

export const FilmIcon = ({ size = 20, className }: Props): JSX.Element => (
  <svg {...base(size)} className={className}>
    <rect x="3" y="4" width="18" height="16" rx="2.5" />
    <path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" />
  </svg>
)

export const UploadIcon = ({ size = 20, className }: Props): JSX.Element => (
  <svg {...base(size)} className={className}>
    <path d="M12 16V4M7 9l5-5 5 5M5 20h14" />
  </svg>
)

export const ClockIcon = ({ size = 20, className }: Props): JSX.Element => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
)

export const ShieldIcon = ({ size = 20, className }: Props): JSX.Element => (
  <svg {...base(size)} className={className}>
    <path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6l-7-3Z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
)

export const MicIcon = ({ size = 22, className }: Props): JSX.Element => (
  <svg {...base(size)} className={className}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8" />
  </svg>
)

export const MicOffIcon = ({ size = 22, className }: Props): JSX.Element => (
  <svg {...base(size)} className={className}>
    <path d="M9 9v2a3 3 0 0 0 4.6 2.6M15 10V6a3 3 0 0 0-5.4-1.8" />
    <path d="M5 11a7 7 0 0 0 10.6 6M19 11a6.7 6.7 0 0 1-.5 2.5M12 18v3M8 21h8M3 3l18 18" />
  </svg>
)

export const PauseIcon = ({ size = 22, className }: Props): JSX.Element => (
  <svg {...base(size)} className={className}>
    <rect x="6" y="5" width="4" height="14" rx="1" />
    <rect x="14" y="5" width="4" height="14" rx="1" />
  </svg>
)

export const PlayIcon = ({ size = 22, className }: Props): JSX.Element => (
  <svg {...base(size)} className={className}>
    <path d="M8 5.5v13l11-6.5-11-6.5Z" />
  </svg>
)

export const StarIcon = ({ size = 18, className, filled = false }: Props & { filled?: boolean }): JSX.Element => (
  <svg {...base(size)} className={className} fill={filled ? 'currentColor' : 'none'}>
    <path d="m12 3.5 2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 10l6.1-.9L12 3.5Z" />
  </svg>
)

export const TrashIcon = ({ size = 18, className }: Props): JSX.Element => (
  <svg {...base(size)} className={className}>
    <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />
  </svg>
)

export const DownloadIcon = ({ size = 18, className }: Props): JSX.Element => (
  <svg {...base(size)} className={className}>
    <path d="M12 3v12M7 10l5 5 5-5M5 20h14" />
  </svg>
)

export const EyeIcon = ({ size = 20, className }: Props): JSX.Element => (
  <svg {...base(size)} className={className}>
    <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" />
    <circle cx="12" cy="12" r="2.6" />
  </svg>
)

export const EyeOffIcon = ({ size = 20, className }: Props): JSX.Element => (
  <svg {...base(size)} className={className}>
    <path d="M3 3l18 18M10.6 6.2A11 11 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-3 3.6M6.5 6.9C3.7 8.7 2 12 2 12s3.5 6 10 6c1.3 0 2.6-.2 3.7-.6" />
  </svg>
)

export const SendIcon = ({ size = 18, className }: Props): JSX.Element => (
  <svg {...base(size)} className={className}>
    <path d="M21 3 10 14M21 3l-7 18-4-7-7-4 18-7Z" />
  </svg>
)

export const FolderIcon = ({ size = 18, className }: Props): JSX.Element => (
  <svg {...base(size)} className={className}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
  </svg>
)

export const LockIcon = ({ size = 16, className }: Props): JSX.Element => (
  <svg {...base(size)} className={className}>
    <rect x="5" y="10" width="14" height="10" rx="2" />
    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
  </svg>
)

export const WifiOffIcon = ({ size = 16, className }: Props): JSX.Element => (
  <svg {...base(size)} className={className}>
    <path d="M3 3l18 18M8.5 8.6A10 10 0 0 1 12 8c5 0 8.5 3.5 8.5 3.5M5.5 11.5A10 10 0 0 1 8 9.8M10 15.5a3 3 0 0 1 4 0M12 19h.01" />
  </svg>
)

export const SparkIcon = ({ size = 18, className }: Props): JSX.Element => (
  <svg {...base(size)} className={className}>
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" />
  </svg>
)

export const CheckIcon = ({ size = 18, className }: Props): JSX.Element => (
  <svg {...base(size)} className={className}>
    <path d="m4 12.5 5 5L20 6.5" />
  </svg>
)

export const XIcon = ({ size = 18, className }: Props): JSX.Element => (
  <svg {...base(size)} className={className}>
    <path d="M5 5l14 14M19 5 5 19" />
  </svg>
)

export const UsersIcon = ({ size = 18, className }: Props): JSX.Element => (
  <svg {...base(size)} className={className}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3 20c0-3.3 2.7-5.4 6-5.4s6 2.1 6 5.4M16 5.2a3.2 3.2 0 0 1 0 6M18 14.8c2 .7 3 2.4 3 5.2" />
  </svg>
)

export const KeyboardIcon = ({ size = 18, className }: Props): JSX.Element => (
  <svg {...base(size)} className={className}>
    <rect x="2.5" y="6" width="19" height="12" rx="2" />
    <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" />
  </svg>
)
