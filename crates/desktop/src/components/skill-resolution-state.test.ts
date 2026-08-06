import { describe, expect, it } from "vitest";
import {
	createSkillResolutionViewState,
	INITIAL_SKILL_RESOLUTION_VIEW,
	skillResolutionViewReducer,
} from "./skill-resolution-state";

describe("skillResolutionViewReducer", () => {
	it("opens on the requested comparison version", () => {
		const state = skillResolutionViewReducer(
			INITIAL_SKILL_RESOLUTION_VIEW,
			{
				type: "expand",
				activeVersionId: "version-b",
			},
		);

		expect(state).toEqual({
			isExpanded: true,
			activeVersionId: "version-b",
			defaultStorageMode: "preserve",
			storageMode: "preserve",
			showFileChanges: false,
		});
	});

	it("keeps independent review choices", () => {
		const withStorage = skillResolutionViewReducer(
			INITIAL_SKILL_RESOLUTION_VIEW,
			{ type: "set-storage-mode", storageMode: "copy" },
		);
		const withFiles = skillResolutionViewReducer(withStorage, {
			type: "set-file-changes",
			showFileChanges: true,
		});

		expect(withFiles.storageMode).toBe("copy");
		expect(withFiles.showFileChanges).toBe(true);
	});

	it("resets transient review choices when collapsed", () => {
		const openState = {
			isExpanded: true,
			activeVersionId: "version-b",
			defaultStorageMode: "preserve" as const,
			storageMode: "copy" as const,
			showFileChanges: true,
		};

		expect(
			skillResolutionViewReducer(openState, {
				type: "collapse",
			}),
		).toEqual(INITIAL_SKILL_RESOLUTION_VIEW);
	});

	it("uses the configured file handling when a review opens and resets", () => {
		const initial = createSkillResolutionViewState("copy");
		const opened = skillResolutionViewReducer(initial, {
			type: "expand",
			activeVersionId: "version-b",
		});
		const changed = skillResolutionViewReducer(opened, {
			type: "set-storage-mode",
			storageMode: "preserve",
		});

		expect(opened.storageMode).toBe("copy");
		expect(
			skillResolutionViewReducer(changed, { type: "collapse" }),
		).toEqual(initial);
	});
});
