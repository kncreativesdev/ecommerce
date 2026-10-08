require("dotenv/config");

const app = require("./app");
const { prisma } = require("./config/database");
const { startRetentionScheduler, stopRetentionScheduler } = require("./modules/audit/retention.service");

const PORT = Number(process.env.PORT) || 3000;

const server = app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

// Audit retention cleanup worker (Phase 2C-19): single in-process
// scheduler (one deployment = one worker). First run happens one
// interval after boot — never before init — and NEVER deletes when
// the policy is NEVER. Started only here, never on app import.
startRetentionScheduler();

let isShuttingDown = false;

async function shutdown(signal) {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  console.log(`Received ${signal}, shutting down`);

  server.close(async () => {
    try {
      stopRetentionScheduler();
      await prisma.$disconnect();
      process.exit(0);
    } catch (error) {
      console.error(error);
      process.exit(1);
    }
  });
}

process.on("SIGINT", () => {
  shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  shutdown("SIGTERM");
});
