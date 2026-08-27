export function BrandLockup({ className = "" }: { className?: string }) {
  return (
    <span className={`brand-lockup ${className}`} aria-hidden="true">
      <img
        className="brand-lockup__image brand-lockup__image--dark"
        src="/assets/brand/holymedia-mcp-horizontal.svg"
        alt=""
      />
      <img
        className="brand-lockup__image brand-lockup__image--light"
        src="/assets/brand/holymedia-mcp-horizontal-dark.svg"
        alt=""
      />
    </span>
  );
}
