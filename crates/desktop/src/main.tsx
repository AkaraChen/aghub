import * as React from "react";
import ReactDOM from "react-dom/client";
import { attachConsole, info } from "@tauri-apps/plugin-log";
import App from "./App";
import "./index.css";

async function bootstrap() {
	try {
		await attachConsole();
		await info("Attached Tauri log stream to frontend console");
	} catch (error) {
		console.error("Failed to attach Tauri log stream:", error);
	}

	ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
		<React.StrictMode>
			<App />
		</React.StrictMode>,
	);
}

void bootstrap();
