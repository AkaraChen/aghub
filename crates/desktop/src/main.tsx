import { attachConsole, info } from "@tauri-apps/plugin-log";
import * as React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { capture, installExceptionAutocapture } from "./lib/analytics";
import { log } from "./lib/logger";

async function bootstrap() {
	try {
		await attachConsole();
		await info("Tauri log stream attached to frontend console");
	} catch (error: unknown) {
		console.error("Failed to attach Tauri log stream:", error);
	}

	installExceptionAutocapture();
	capture("app started");
	log.info("app started", {
		"app.version": import.meta.env.VITE_APP_VERSION,
	});

	ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
		<React.StrictMode>
			<App />
		</React.StrictMode>,
	);
}

bootstrap().catch((error: unknown) => {
	console.error("Failed to bootstrap desktop app:", error);
});
