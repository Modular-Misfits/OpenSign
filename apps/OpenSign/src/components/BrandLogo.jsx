import modularMisfitsLogo from "../assets/images/modular-misfits-logo.png";

/**
 * Shared Modular Misfits lockup used on public signing and authenticated pages.
 *
 * OpenSign can still supply a tenant-specific logo. When one is present, keep
 * rendering it unchanged; otherwise render the first-party lockup so the
 * signing experience matches the Compound portal.
 */
export default function BrandLogo({ logo, compact = false, className = "" }) {
  const hasCustomLogo = logo && logo !== modularMisfitsLogo;

  if (hasCustomLogo) {
    return (
      <img
        src={logo}
        className={`object-contain h-full w-auto ${className}`}
        alt="Organization logo"
      />
    );
  }

  return (
    <div
      className={`mm-brand-lockup ${compact ? "mm-brand-lockup--compact" : ""} ${className}`}
      aria-label="Modular Misfits Agreements"
    >
      <span className="mm-brand-mark" aria-hidden="true">
        <img src={modularMisfitsLogo} alt="" />
      </span>
      <span className="mm-brand-copy">
        <strong>Modular Misfits</strong>
        <span>Agreements</span>
      </span>
    </div>
  );
}
