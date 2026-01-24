import type { SVGProps } from "react";

export function AppLogo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M12 2a10 10 0 0 0-3.9 19.4A10 10 0 0 0 16.5 4H8" />
      <path d="M8 16.5A10 10 0 0 0 21.4 7.1A10 10 0 0 0 8 16.5" />
    </svg>
  );
}
