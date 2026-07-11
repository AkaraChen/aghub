// e2e-only vite config: mirrors vite.config.ts plugins, serves on a free
// port, proxies /api to a standalone aghub-api (same-origin, no CORS), and
// injects a minimal __TAURI_INTERNALS__ shim so the app boots in a plain
// browser. Untracked — for browser e2e only. Run with cwd = crates/desktop:
//   bunx vite --config vite.e2e.config.ts
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const E2E_PORT = 14321;
const API_PORT = 18001;
const API_TOKEN = "e2e-test-token";

// start_server reports the vite port itself, so the app's derived baseUrl
// (http://localhost:<port>/api/v1) lands on the same-origin /api proxy.
const TAURI_SHIM = `
window.isTauri = true;
const stores = new Map();
let nextRid = 1;
let nextCallbackId = 1;
function storeByRid(args) {
	const store = stores.get(args.rid);
	if (!store) throw new Error("e2e-shim: unknown store rid " + args.rid);
	return store;
}
window.__TAURI_INTERNALS__ = {
	metadata: {
		currentWindow: { label: "main" },
		currentWebview: { label: "main", windowLabel: "main" },
	},
	transformCallback(callback) {
		const id = nextCallbackId++;
		window["_" + id] = callback;
		return id;
	},
	async invoke(cmd, args = {}) {
		if (cmd === "start_server") {
			return { port: ${E2E_PORT}, token: "${API_TOKEN}" };
		}
		if (cmd.startsWith("plugin:store|")) {
			const op = cmd.slice("plugin:store|".length);
			switch (op) {
				case "load":
				case "get_store": {
					const rid = nextRid++;
					stores.set(rid, new Map());
					return rid;
				}
				case "get": {
					const store = storeByRid(args);
					return [store.get(args.key) ?? null, store.has(args.key)];
				}
				case "set":
					storeByRid(args).set(args.key, args.value);
					return null;
				case "has":
					return storeByRid(args).has(args.key);
				case "delete":
					return storeByRid(args).delete(args.key);
				case "keys":
					return [...storeByRid(args).keys()];
				case "values":
					return [...storeByRid(args).values()];
				case "entries":
					return [...storeByRid(args).entries()];
				case "length":
					return storeByRid(args).size;
				case "clear":
					storeByRid(args).clear();
					return null;
				default:
					// save / reload / reset are no-ops in memory
					return null;
			}
		}
		if (cmd.startsWith("plugin:log|")) {
			console.debug("[tauri-log]", args?.message ?? args);
			return null;
		}
		if (cmd.startsWith("plugin:event|")) {
			// listen returns an event id; nothing ever fires in the browser.
			return nextCallbackId++;
		}
		if (cmd === "plugin:opener|open_url") {
			window.open(args.url, "_blank");
			return null;
		}
		if (cmd.startsWith("plugin:deep-link|")) {
			return null;
		}
		console.warn("e2e-shim: unhandled invoke", cmd, args);
		throw new Error("e2e-shim: unhandled command " + cmd);
	},
};
`;

export default defineConfig({
	plugins: [
		react({
			babel: {
				plugins: [["babel-plugin-react-compiler", { target: "19" }]],
			},
		}),
		tailwindcss(),
		{
			name: "e2e-tauri-shim",
			transformIndexHtml() {
				return [
					{
						tag: "script",
						injectTo: "head-prepend",
						children: TAURI_SHIM,
					},
				];
			},
		},
	],
	clearScreen: false,
	server: {
		port: E2E_PORT,
		strictPort: true,
		proxy: {
			"/api": {
				target: `http://127.0.0.1:${API_PORT}`,
				changeOrigin: true,
			},
		},
	},
});
