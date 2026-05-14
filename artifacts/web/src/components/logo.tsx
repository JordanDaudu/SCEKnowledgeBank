type LogoProps = React.SVGProps<SVGSVGElement>;

export function Logo({ strokeWidth = 3.5, ...props }: LogoProps & { strokeWidth?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label="Knowledge Bank"
      {...props}
    >
      <circle cx="32" cy="32" r="25.5" />
      <path d="M32 3 v3.5" />
      <path d="M32 22.5 V44.5" />
      <path d="M32 22.5 C 26.5 20.5, 20 20.5, 14.5 22.5 V42.5 C 20 40.5, 26.5 40.5, 32 43.5" />
      <path d="M32 22.5 C 37.5 20.5, 44 20.5, 49.5 22.5 V42.5 C 44 40.5, 37.5 40.5, 32 43.5" />
    </svg>
  );
}
