import app from "./app";
import { env } from "./lib/env";
import { logger } from "./lib/logger";

app.listen(env.port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port: env.port }, "Server listening");
});
