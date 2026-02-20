import { serve } from "@hono/node-server";
import { stopChrome } from "./chrome.js";
import { disconnect } from "./playwright.js";
import { app } from "./routes.js";
import { DEFAULT_SERVER_PORT } from "./types.js";

const port = Number(process.env.BROWSER_PORT) || DEFAULT_SERVER_PORT;

const server = serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, () => {
	console.log(`Browser control server listening on http://127.0.0.1:${port}`);
});

function shutdown() {
	console.log("Shutting down...");
	disconnect();
	stopChrome();
	server.close();
	process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
