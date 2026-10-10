import "./env.ts";
import { buildApp } from "./app.ts";
import { prisma } from "./db.ts";
import { startWorker } from "./worker.ts";

const port = Number(process.env.PORT || 4721);
const app = buildApp();
startWorker();

app
  .listen({ port, host: "0.0.0.0" })
  .then(() => {
    app.log.info(`LaunchForensics API listening on ${port}`);
  })
  .catch(async (error) => {
    app.log.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
