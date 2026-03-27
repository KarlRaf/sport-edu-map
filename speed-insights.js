import { injectSpeedInsights } from "./vendor/vercel-speed-insights.mjs";

const isLocalHost =
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1";

injectSpeedInsights({
  debug: isLocalHost,
});
