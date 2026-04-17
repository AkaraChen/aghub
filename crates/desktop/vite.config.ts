import process from "node:process";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const host = process.env.TAURI_DEV_HOST;

function vendorChunk(id: string) {
	if (!id.includes("node_modules")) {
		return undefined;
	}

	if (
		id.includes("@heroui/") ||
		id.includes("react-aria-components") ||
		id.includes("@react-aria/") ||
		id.includes("@react-stately/")
	) {
		return "ui-vendor";
	}

	if (
		id.includes("@tanstack/react-query") ||
		id.includes("ky") ||
		id.includes("i18next") ||
		id.includes("wouter")
	) {
		return "data-vendor";
	}

	if (id.includes("@tauri-apps/")) {
		return "tauri-vendor";
	}

	if (
		id.includes("/react/") ||
		id.includes("/react-dom/") ||
		id.includes("/scheduler/")
	) {
		return "react-vendor";
	}

	return "vendor";
}

// https://vite.dev/config/
export default defineConfig(async () => ({
	plugins: [
		react({
			babel: {
				plugins: [["babel-plugin-react-compiler", { target: "19" }]],
			},
		}),
		tailwindcss(),
	],

	// Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
	//
	// 1. prevent Vite from obscuring rust errors
	clearScreen: false,
	// 2. tauri expects a fixed port, fail if that port is not available
	server: {
		port: 1420,
		strictPort: true,
		host: host || false,
		hmr: host
			? {
					protocol: "ws",
					host,
					port: 1421,
				}
			: undefined,
		watch: {
			// 3. tell Vite to ignore watching `src-tauri`
			ignored: ["**/src-tauri/**"],
		},
	},
	build: {
		rollupOptions: {
			output: {
				manualChunks: vendorChunk,
			},
		},
	},
}));
