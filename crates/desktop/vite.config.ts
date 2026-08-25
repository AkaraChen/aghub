import process from "node:process";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const host = process.env.TAURI_DEV_HOST;
// HeroUI and React Aria share one UI foundation chunk that currently builds
// near 560 kB before compression.
const SHARED_UI_CHUNK_WARNING_LIMIT_KB = 600;

function vendorChunk(id: string) {
	if (!id.includes("node_modules")) {
		return undefined;
	}

	if (
		id.includes("react-aria-components") ||
		id.includes("react-aria") ||
		id.includes("react-stately") ||
		id.includes("@react-aria/") ||
		id.includes("@react-stately/") ||
		id.includes("@internationalized/")
	) {
		return "aria-vendor";
	}

	if (
		id.includes("@heroui/") ||
		id.includes("@radix-ui/") ||
		id.includes("tailwind-merge") ||
		id.includes("tailwind-variants")
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
		id.includes("simple-icons") ||
		id.includes("@heroicons/") ||
		id.includes("@lobehub/icons")
	) {
		return "icons-vendor";
	}

	if (id.includes("posthog-js") || id.includes("@opentelemetry/")) {
		return "telemetry-vendor";
	}

	if (
		id.includes("@dnd-kit/") ||
		id.includes("react-hook-form") ||
		id.includes("react-virtuoso") ||
		id.includes("rooks")
	) {
		return "interaction-vendor";
	}

	if (
		id.includes("/node_modules/react/") ||
		id.includes("/node_modules/react-dom/") ||
		id.includes("/node_modules/scheduler/")
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
	resolve: {
		dedupe: ["react-aria"],
	},
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
		chunkSizeWarningLimit: SHARED_UI_CHUNK_WARNING_LIMIT_KB,
		rollupOptions: {
			output: {
				manualChunks: vendorChunk,
			},
		},
	},
}));
