import { inject } from "./vendor/vercel-analytics.mjs";

const isLocalHost =
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1";

inject({
  mode: isLocalHost ? "development" : "production",
});
