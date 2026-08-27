export function BrandLockup({ className = "" }: { className?: string }) {
  return (
    <span className={`brand-lockup ${className}`} aria-hidden="true">
      <img
        className="brand-lockup__image"
        src="/assets/brand/holymedia-mcp-logo.svg"
        alt=""
      />
    </span>
  );
}
