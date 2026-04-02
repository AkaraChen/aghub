import type { Store } from "@tauri-apps/plugin-store";
import { CURRENT_VERSION } from "../types";
import { migrateV0ToV1 } from "./v0-to-v1";
import { migrateV1ToV2 } from "./v1-to-v2";
import { migrateV2ToV3 } from "./v2-to-v3";
import { migrateV3ToV4 } from "./v3-to-v4";
import { migrateV4ToV5 } from "./v4-to-v5";

export async function migrate(store: Store): Promise<void> {
	const version = (await store.get<number>("version")) ?? 0;

	if (version === CURRENT_VERSION) return;

	if (version < 1) {
		await migrateV0ToV1(store);
	}

	if (version < 2) {
		await migrateV1ToV2(store);
	}

	if (version < 3) {
		await migrateV2ToV3(store);
	}

	if (version < 4) {
		await migrateV3ToV4(store);
	}

	if (version < 5) {
		await migrateV4ToV5(store);
	}

	await store.set("version", CURRENT_VERSION);
	await store.save();
}
