import { attachConsole, info } from "@tauri-apps/plugin-log";
import * as React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import {
	capture,
	initBrowserPosthog,
	installExceptionAutocapture,
} from "./lib/analytics";
import { log } from "./lib/logger";
import { suppressNativeContextMenu } from "./lib/suppress-native-context-menu";

async function bootstrap() {
	suppressNativeContextMenu();

	try {
		await attachConsole();
		await info("Tauri log stream attached to frontend console");
	} catch (error: unknown) {
		console.error("Failed to attach Tauri log stream:", error);
	}

	// posthog-js needs the Rust-owned distinct_id before it boots so
	// replay attaches to the same person as Rust-originated events.
	await initBrowserPosthog();
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
