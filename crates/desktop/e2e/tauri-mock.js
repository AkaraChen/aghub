// Injected via addInitScript before the app boots: fakes the Tauri v2
// IPC surface so the renderer runs in a plain browser. Stores live in
// an in-page Map, matching the tauri-plugin-store wire protocol.
(() => {
	const apiPort = window.__AGHUB_E2E_API_PORT__ ?? 45999;
	const storeData = new Map(); // path -> Map<key, value>
	const stores = new Map(); // rid -> Map<key, value>
	const updateChecks = [];
	let availableUpdate = null;
	let shouldDeferUpdateCheck = false;
	let resolveUpdateCheck = null;
	let resolveUpdateInstall = null;
	let nextRid = 1;
	let nextMenuRid = 1_000;
	const onboardingMode = new URLSearchParams(location.search).get(
		"__e2eOnboarding",
	);
	const persistedStoreKey = `aghub-e2e-store:${onboardingMode ?? "default"}`;
	const initialDeepLink = new URLSearchParams(window.location.search).get(
		"e2eDeepLink",
	);

	const defaultEntries = [
		["version", 12],
		["skillAuditEnabled", true],
		[
			"skillPreferences",
			{
				enabled: true,
				mode: "automatic",
				groupIdenticalCopies: true,
				warnOnConflicts: true,
				defaultStorageMode: "preserve",
				discovery: {
					projectSkills: true,
					embeddedSkills: true,
					dependencySkills: false,
				},
			},
		],
		["acknowledgedSkillAssessments", []],
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
	];
	const persistedEntries = sessionStorage.getItem(persistedStoreKey);
	const seeded = new Map(
		persistedEntries ? JSON.parse(persistedEntries) : defaultEntries,
	);
	if (!persistedEntries && onboardingMode === "fresh") {
		seeded.set("onboardingProgress", {
			hasSeenWelcome: false,
			completedTours: { productMap: false, projectWorkflow: false },
		});
		seeded.set("analyticsConsent", "denied");
		seeded.set("analyticsConsentAcked", false);
		seeded.delete("lastSeenWhatsNewVersion");
	}
	if (!persistedEntries && onboardingMode === "upgrade") {
		seeded.set("lastSeenWhatsNewVersion", "0.1.0");
	}
	storeData.set("store.json", seeded);

	function persistStore() {
		sessionStorage.setItem(
			persistedStoreKey,
			JSON.stringify([...seeded.entries()]),
		);
	}

	function invoke(cmd, args = {}) {
		switch (cmd) {
			case "start_server":
				return Promise.resolve({ port: apiPort, token: "e2e-token" });
			case "plugin:app|name":
				return Promise.resolve("aghub");
			case "plugin:app|version":
				return Promise.resolve("1.9.0-beta.1");
			case "posthog_get_config":
				return Promise.resolve({ key: null, host: null });
			case "posthog_get_distinct_id":
				return Promise.resolve("e2e-distinct-id");
			case "posthog_get_session_id":
				return Promise.resolve("e2e-session-id");
			case "posthog_set_enabled":
			case "posthog_capture":
			case "plugin:log|log":
				return Promise.resolve(null);
			case "plugin:autostart|is_enabled":
				return Promise.resolve(false);
			case "plugin:deep-link|get_current":
				return Promise.resolve(
					initialDeepLink ? [initialDeepLink] : null,
				);
			case "plugin:menu|new": {
				const rid = nextMenuRid++;
				return Promise.resolve([
					rid,
					args.options?.id ?? `e2e-menu-${rid}`,
				]);
			}
			case "plugin:menu|set_as_app_menu":
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
				persistStore();
				return Promise.resolve(null);
			case "plugin:store|clear":
			case "plugin:store|reset":
			case "plugin:store|reload":
			case "plugin:resources|close":
				return Promise.resolve(null);
			case "plugin:window|is_maximized":
				return Promise.resolve(false);
			case "plugin:updater|check":
				// No update available
				return Promise.resolve(null);
			case "plugin:updater|download_and_install":
				return new Promise((resolve) => {
					resolveUpdateInstall = resolve;
				});
			case "check_for_update":
				updateChecks.push(args.channel);
				if (shouldDeferUpdateCheck) {
					return new Promise((resolve) => {
						resolveUpdateCheck = resolve;
					});
				}
				return Promise.resolve(availableUpdate);
			default:
				if (cmd.startsWith("plugin:event|")) return Promise.resolve(0);
				// An unknown command must fail loudly: silently resolving
				// null would let the suite stay green while the real app
				// errors on a renamed or missing command.
				console.warn(`[tauri-mock] unmocked command: ${cmd}`);
				return Promise.reject(
					new Error(`[tauri-mock] unmocked command: ${cmd}`),
				);
		}
	}

	window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
		unregisterListener: () => {},
	};

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
	window.__AGHUB_E2E__ = {
		clearUpdateChecks() {
			updateChecks.length = 0;
		},
		deferUpdateCheck() {
			shouldDeferUpdateCheck = true;
		},
		finishUpdateCheck() {
			resolveUpdateCheck?.(availableUpdate);
			resolveUpdateCheck = null;
			shouldDeferUpdateCheck = false;
		},
		finishUpdateInstall() {
			resolveUpdateInstall?.(null);
			resolveUpdateInstall = null;
		},
		getStoreValue(key) {
			return seeded.get(key);
		},
		getUpdateChecks() {
			return [...updateChecks];
		},
		setAvailableUpdate() {
			availableUpdate = {
				rid: nextRid++,
				currentVersion: "1.9.0-beta.1",
				version: "2.0.0-beta.1",
				rawJson: {},
			};
		},
	};
})();
