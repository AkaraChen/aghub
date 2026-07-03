// Injected via addInitScript before the app boots: fakes the Tauri v2
// IPC surface so the renderer runs in a plain browser. Stores live in
// an in-page Map, matching the tauri-plugin-store wire protocol.
(() => {
	const storeData = new Map(); // path -> Map<key, value>
	const stores = new Map(); // rid -> Map<key, value>
	let nextRid = 1;

	// Pre-seeded store.json: onboarding done, analytics declined, so no
	// welcome dialog or tour blocks the UI under test.
	const seeded = new Map([
		["version", 9],
		[
			"onboardingProgress",
			{
				hasSeenWelcome: true,
				completedTours: { productMap: true, projectWorkflow: true },
			},
		],
		["analyticsConsent", "denied"],
		["analyticsConsentAcked", true],
		["lastSeenWhatsNewVersion", "99.99.99"],
		["skillGroups", []],
		["skillGroupAssignments", {}],
		["mcpGroups", []],
		["mcpGroupAssignments", {}],
		[
			"projects",
			[{ id: "p1", name: "demo-project", path: "/tmp/e2e/demo" }],
		],
	]);
	storeData.set("store.json", seeded);

	function invoke(cmd, args = {}) {
		switch (cmd) {
			case "start_server":
				return Promise.resolve({ port: 45999, token: "e2e-token" });
			case "posthog_get_config":
				return Promise.resolve({ key: null, host: null });
			case "posthog_get_distinct_id":
				return Promise.resolve("e2e-distinct-id");
			case "posthog_get_session_id":
				return Promise.resolve("e2e-session-id");
			case "posthog_set_enabled":
			case "posthog_capture":
				return Promise.resolve(null);
			case "plugin:store|load":
			case "plugin:store|get_store": {
				const path = args.path;
				if (!storeData.has(path)) storeData.set(path, new Map());
				const rid = nextRid++;
				stores.set(rid, storeData.get(path));
				return Promise.resolve(rid);
			}
			case "plugin:store|get": {
				const m = stores.get(args.rid);
				const exists = m ? m.has(args.key) : false;
				return Promise.resolve([
					exists ? m.get(args.key) : null,
					exists,
				]);
			}
			case "plugin:store|set": {
				const m = stores.get(args.rid);
				if (m) m.set(args.key, args.value);
				return Promise.resolve(null);
			}
			case "plugin:store|has": {
				const m = stores.get(args.rid);
				return Promise.resolve(m ? m.has(args.key) : false);
			}
			case "plugin:store|delete": {
				const m = stores.get(args.rid);
				return Promise.resolve(m ? m.delete(args.key) : false);
			}
			case "plugin:store|keys": {
				const m = stores.get(args.rid);
				return Promise.resolve(m ? [...m.keys()] : []);
			}
			case "plugin:store|values": {
				const m = stores.get(args.rid);
				return Promise.resolve(m ? [...m.values()] : []);
			}
			case "plugin:store|entries": {
				const m = stores.get(args.rid);
				return Promise.resolve(m ? [...m.entries()] : []);
			}
			case "plugin:store|save":
			case "plugin:store|clear":
			case "plugin:store|reset":
			case "plugin:store|reload":
			case "plugin:resources|close":
				return Promise.resolve(null);
			default:
				if (cmd.startsWith("plugin:event|")) return Promise.resolve(0);
				return Promise.resolve(null);
		}
	}

	window.__TAURI_INTERNALS__ = {
		invoke,
		transformCallback: () => Math.floor(Math.random() * 1e9),
		unregisterCallback: () => {},
		metadata: {
			currentWindow: { label: "main" },
			currentWebview: { label: "main", windowLabel: "main" },
		},
		plugins: {},
		convertFileSrc: (p) => p,
	};
})();
