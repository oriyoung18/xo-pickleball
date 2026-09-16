// Upgrade 13 — Production Auth public configuration.
// The Turnstile SITE KEY is public and safe to keep in GitHub.
// NEVER put your Cloudflare Turnstile secret key here. The secret belongs only in Supabase.
window.XO_AUTH_CONFIG = {
  TURNSTILE_SITE_KEY: "0x4AAAAAAE334685OblUfDnv"
};

// PWA bootstrap.
// This is intentionally loaded from auth-config.js so the PWA upgrade can be
// installed without rewriting XO's large index.html/app.js files.
(() => {
  const head = document.head;

  const viewport = head.querySelector('meta[name="viewport"]');
  if (viewport) {
    viewport.setAttribute(
      "content",
      "width=device-width, initial-scale=1, viewport-fit=cover"
    );
  }

  const meta = (name, content) => {
    let el = head.querySelector(`meta[name="${name}"]`);
    if (!el) {
      el = document.createElement("meta");
      el.name = name;
      head.appendChild(el);
    }
    el.content = content;
  };

  const link = (rel, href, extras = {}) => {
    let el = head.querySelector(`link[rel="${rel}"][href="${href}"]`);
    if (!el) {
      el = document.createElement("link");
      el.rel = rel;
      el.href = href;
      Object.entries(extras).forEach(([k, v]) => el.setAttribute(k, v));
      head.appendChild(el);
    }
    return el;
  };

  meta("theme-color", "#111318");
  meta("apple-mobile-web-app-capable", "yes");
  meta("apple-mobile-web-app-status-bar-style", "black-translucent");
  meta("apple-mobile-web-app-title", "XO Pickleball");
  meta("mobile-web-app-capable", "yes");

  link("manifest", "/manifest.webmanifest");
  link("apple-touch-icon", "/apple-touch-icon.png", { sizes: "180x180" });
  link("icon", "/icon-192.png", { type: "image/png", sizes: "192x192" });
  link("stylesheet", "/pwa.css");

  const pwaScript = document.createElement("script");
  pwaScript.src = "/pwa.js";
  pwaScript.defer = true;
  document.body.appendChild(pwaScript);
})();
