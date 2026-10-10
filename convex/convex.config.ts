import { defineApp } from "convex/server";
import staticHosting from "@convex-dev/static-hosting/convex.config";
import agent from "@convex-dev/agent/convex.config";
import workflow from "@convex-dev/workflow/convex.config.js";

const app = defineApp();
app.use(staticHosting);
app.use(agent, { name: "agent" });
app.use(workflow);
export default app;
