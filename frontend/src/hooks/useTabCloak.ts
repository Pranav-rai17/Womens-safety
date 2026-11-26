import { useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";

const ORIGINAL_TITLE = "SafeGuard AI — Autonomous Women's Safety & Command Platform";

const CALCULATOR_FAVICON_SVG = encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#1e293b"/>
  <rect x="14" y="10" width="36" height="12" rx="3" fill="#94a3b8"/>
  <circle cx="20" cy="32" r="4" fill="#e2e8f0"/>
  <circle cx="32" cy="32" r="4" fill="#e2e8f0"/>
  <circle cx="44" cy="32" r="4" fill="#38bdf8"/>
  <circle cx="20" cy="44" r="4" fill="#e2e8f0"/>
  <circle cx="32" cy="44" r="4" fill="#e2e8f0"/>
  <circle cx="44" cy="44" r="4" fill="#38bdf8"/>
</svg>
`);

const SAFEGUARD_FAVICON_SVG = encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#0A0809"/>
  <path d="M32 10L50 18V32C50 43.5 42.2 52.8 32 56C21.8 52.8 14 43.5 14 32V18L32 10Z" fill="#E84C3D"/>
</svg>
`);

function setFavicon(svgEncoded: string) {
  let link = document.querySelector<HTMLLinkElement>("link[rel*='icon']");
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  link.type = "image/svg+xml";
  link.href = `data:image/svg+xml,${svgEncoded}`;
}

export function activateTabCloak() {
  document.title = "Calculator";
  setFavicon(CALCULATOR_FAVICON_SVG);
}

export function restoreTabCloak() {
  document.title = ORIGINAL_TITLE;
  setFavicon(SAFEGUARD_FAVICON_SVG);
}

/**
 * Global Tab-Cloak Panic Hook:
 * Double-pressing `Esc` anywhere in the app immediately navigates to `/vault`,
 * sets document.title to "Calculator - Quick Tools", and swaps the browser favicon
 * to a neutral calculator icon while keeping background tracking active.
 */
export function useTabCloak() {
  const navigate = useNavigate();
  const lastEscRef = useRef<number>(0);

  const triggerCloak = useCallback(() => {
    activateTabCloak();
    navigate("/vault");
  }, [navigate]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const now = Date.now();
      if (now - lastEscRef.current <= 600) {
        lastEscRef.current = 0;
        triggerCloak();
      } else {
        lastEscRef.current = now;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [triggerCloak]);

  return { triggerCloak, activateTabCloak, restoreTabCloak };
}
