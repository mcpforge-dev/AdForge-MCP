export function BrandLockup({ className = "" }: { className?: string }) {
  return (
    <span className={`brand-lockup ${className}`} aria-hidden="true">
      <span className="brand-lockup__mark" />
      <span className="brand-lockup__wordmark" />
    </span>
  );
}
