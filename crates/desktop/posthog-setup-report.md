# PostHog setup report

PostHog integration is now driven by a backend-owned `AppConfig` instead of frontend `VITE_*` environment reads.

- `get_app_config` returns a typed config before React renders, including analytics consent, app version, PostHog key/host, distinct id, and session id.
- `set_app_config` keeps the backend copy in sync when onboarding/settings changes analytics consent.
- Frontend code reads config from React context and mirrors updates back to the backend.
- PostHog env names are `POSTHOG_KEY` / `POSTHOG_HOST`; the webview never reads them directly.
- Analytics defaults to disabled when no persisted consent exists. Clients may initialize when credentials exist, but capture/identify early-return unless `analyticsEnabled` is true.
