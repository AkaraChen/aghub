import { describe, expect, it } from "vitest";
import {
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
			storageMode: "copy" as const,
			showFileChanges: true,
		};

		expect(
			skillResolutionViewReducer(openState, {
				type: "collapse",
			}),
		).toEqual(INITIAL_SKILL_RESOLUTION_VIEW);
	});
});
