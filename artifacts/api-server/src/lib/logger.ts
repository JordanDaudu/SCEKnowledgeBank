import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "res.headers['set-cookie']",
      // Signed-URL tokens are sensitive bearer credentials — never log
      // them via query string, custom header, or response body.
      "req.query.token",
      "req.headers['x-signed-token']",
      "*.token",
      "*.signedUrl",
    ],
    censor: "[REDACTED]",
  },
  // Strip ?token=… from the logged URL (pino's default serializer keeps
  // the raw URL with the query string).
  serializers: {
    req(req: { method?: string; url?: string; headers?: Record<string, string> }) {
      const url = typeof req.url === "string"
        ? req.url.replace(/([?&])(token|signature|sig)=[^&]+/gi, "$1$2=[REDACTED]")
        : req.url;
      return { method: req.method, url };
    },
  },
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});
