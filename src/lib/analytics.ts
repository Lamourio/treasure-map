// Google Analytics 4. Loaded only in production builds and only when a measurement ID is set
// (VITE_GA_ID, e.g. in .env.production or the host's build environment), so local dev never sends hits.

type Gtag = (...args: unknown[]) => void;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: Gtag;
  }
}

const GA_ID = import.meta.env.VITE_GA_ID as string | undefined;

export function initAnalytics(): void {
  if (!import.meta.env.PROD || !GA_ID || window.gtag) return;
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_ID)}`;
  document.head.appendChild(s);
  window.dataLayer = window.dataLayer || [];
  // gtag.js expects the real `arguments` object, not an array
  window.gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer!.push(arguments);
  };
  window.gtag('js', new Date());
  window.gtag('config', GA_ID);
}

/** Sends a custom event (no-op when analytics is off). */
export function trackEvent(name: string, params?: Record<string, unknown>): void {
  window.gtag?.('event', name, params);
}
