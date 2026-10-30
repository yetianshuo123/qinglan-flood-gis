import type { SVGProps } from 'react'

export type IconName =
  | 'cursor'
  | 'ruler'
  | 'area'
  | 'query-polygon'
  | 'query-point'
  | 'trash'
  | 'reset'
  | 'layers'
  | 'sliders'
  | 'compare'
  | 'locate'
  | 'eye'
  | 'eye-off'
  | 'chevron'
  | 'close'
  | 'play'
  | 'pause'
  | 'info'
  | 'save'
  | 'chart'
  | 'expand'
  | 'water'
  | 'building'
  | 'road'

const PATHS: Record<IconName, string[]> = {
  cursor: ['M5 3l14 8-6.2 1.6L10.5 19z'],
  ruler: ['M3 16L16 3l5 5L8 21z', 'M7 12l2 2', 'M10 9l2 2', 'M13 6l2 2'],
  area: ['M4 6l6-2 9 3 1 9-8 3-8-4z', 'M4 6l8 4 7-3', 'M12 10v9'],
  'query-polygon': ['M4 7l5-3 10 2-2 10-10 2z', 'M10 11h.01'],
  'query-point': ['M12 3v4', 'M12 17v4', 'M3 12h4', 'M17 12h4', 'M12 8a4 4 0 100 8 4 4 0 000-8z'],
  trash: ['M4 7h16', 'M9 7V4h6v3', 'M7 7l1 14h8l1-14', 'M10 11v6', 'M14 11v6'],
  reset: ['M12 4a8 8 0 108 8', 'M12 4v5h-5'],
  layers: ['M12 3l9 5-9 5-9-5z', 'M3 12l9 5 9-5', 'M3 16l9 5 9-5'],
  sliders: ['M4 7h9', 'M17 7h3', 'M4 17h4', 'M12 17h8', 'M15 5v4', 'M10 15v4'],
  compare: ['M12 3v18', 'M4 7h5', 'M4 15h5', 'M15 6h5', 'M15 13h5', 'M15 19h5'],
  locate: ['M12 21s6.5-6.6 6.5-11.5a6.5 6.5 0 10-13 0C5.5 14.4 12 21 12 21z', 'M12 9.5h.01'],
  eye: ['M2.5 12S6.5 5.5 12 5.5 21.5 12 21.5 12 17.5 18.5 12 18.5 2.5 12 2.5 12z', 'M12 9a3 3 0 100 6 3 3 0 000-6z'],
  'eye-off': ['M3 3l18 18', 'M10.6 6.1A9.5 9.5 0 0112 6c5.5 0 9.5 6 9.5 6a17 17 0 01-3.2 3.8', 'M6.2 7.7A16.6 16.6 0 002.5 12S6.5 18 12 18c1 0 2-.2 2.9-.5'],
  chevron: ['M9 6l6 6-6 6'],
  close: ['M6 6l12 12', 'M18 6L6 18'],
  play: ['M8 5l11 7-11 7z'],
  pause: ['M9 5v14', 'M15 5v14'],
  info: ['M12 21a9 9 0 100-18 9 9 0 000 18z', 'M12 11v5', 'M12 8h.01'],
  save: ['M5 4h11l3 3v13H5z', 'M8 4v6h7V4', 'M8 20v-6h8v6'],
  chart: ['M4 20V11', 'M10 20V4', 'M16 20v-6', 'M2 20h20'],
  expand: ['M4 9V4h5', 'M20 15v5h-5', 'M4 15v5h5', 'M20 9V4h-5'],
  water: ['M3 9c2.5-3 5-3 7.5 0s5 3 7.5 0', 'M3 15c2.5-3 5-3 7.5 0s5 3 7.5 0'],
  building: ['M5 21V4h9v17', 'M14 9h5v12', 'M8 8h3', 'M8 12h3', 'M8 16h3', 'M17 13h1', 'M17 17h1'],
  road: ['M6 21L9 3', 'M18 21L15 3', 'M12 6v3', 'M12 12v3', 'M12 18v2'],
}

interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName
  size?: number
}

export function Icon({ name, size = 16, ...rest }: IconProps) {
  const paths = PATHS[name]
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {paths.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  )
}
