const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const cookieParser = require("cookie-parser");

const { env } = require("./config/env");
const { requestLogger } = require("./middleware/requestLogger");
const { apiRateLimiter } = require("./middleware/rateLimiter");
const { notFoundHandler, errorHandler } = require("./middleware/errorHandler");
const { UPLOADS_ROOT } = require("./modules/media/storage/local.storage");
const apiRouter = require("./routes");

const app = express();

// Product/category images are public storefront assets served cross-origin
// (admin at :3001, storefront at :5173), so CORP must allow cross-origin
// embedding. All other helmet defaults stay intact.
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors({ origin: env.corsOrigin, credentials: true }));
app.use(requestLogger);

// Serve `storage/uploads` so `{MEDIA_BASE_URL}{storagePath}` references
// (e.g. `products/<id>/<uuid>.webp`) resolve in browsers. Mounted before
// the API rate limiter — image loads must not consume the API budget.
// Only files written by the upload endpoints exist under this root, and
// traversal outside it is rejected by the storage adapter.
app.use(express.static(UPLOADS_ROOT, { maxAge: "7d", immutable: false }));
app.use(apiRateLimiter);
app.use(express.json());
app.use(cookieParser());

app.use("/api/v1", apiRouter);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
