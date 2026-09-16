// Upgrade 13 — Production Auth public configuration.
// The Turnstile SITE KEY is public and safe to keep in GitHub.
// NEVER put your Cloudflare Turnstile secret key here. The secret belongs only in Supabase.
window.XO_AUTH_CONFIG = {
  TURNSTILE_SITE_KEY: "0x4AAAAAAE334685OblUfDnv"
};
