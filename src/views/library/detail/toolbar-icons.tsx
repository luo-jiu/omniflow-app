import type { SVGProps } from 'react';

export function ToolbarGridIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      aria-hidden="true"
      fill="currentColor"
      height="15"
      viewBox="0 0 15 15"
      width="15"
      {...props}
    >
      <rect x="1" y="1" width="3" height="3" rx="0.6" />
      <rect x="6" y="1" width="3" height="3" rx="0.6" />
      <rect x="11" y="1" width="3" height="3" rx="0.6" />
      <rect x="1" y="6" width="3" height="3" rx="0.6" />
      <rect x="6" y="6" width="3" height="3" rx="0.6" />
      <rect x="11" y="6" width="3" height="3" rx="0.6" />
      <rect x="1" y="11" width="3" height="3" rx="0.6" />
      <rect x="6" y="11" width="3" height="3" rx="0.6" />
      <rect x="11" y="11" width="3" height="3" rx="0.6" />
    </svg>
  );
}
