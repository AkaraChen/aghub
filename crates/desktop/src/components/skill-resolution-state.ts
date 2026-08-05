import type { SkillCopyStorageModeRequest } from "../generated/dto";

export interface SkillResolutionViewState {
	isExpanded: boolean;
	activeVersionId: string | null;
	storageMode: SkillCopyStorageModeRequest;
	showFileChanges: boolean;
}

export type SkillResolutionViewAction =
	| { type: "expand"; activeVersionId: string | null }
	| { type: "collapse" }
	| { type: "set-active-version"; activeVersionId: string | null }
	| {
			type: "set-storage-mode";
			storageMode: SkillCopyStorageModeRequest;
	  }
	| { type: "set-file-changes"; showFileChanges: boolean };

export const INITIAL_SKILL_RESOLUTION_VIEW: SkillResolutionViewState = {
	isExpanded: false,
	activeVersionId: null,
	storageMode: "preserve",
	showFileChanges: false,
};

export function skillResolutionViewReducer(
	state: SkillResolutionViewState,
	action: SkillResolutionViewAction,
): SkillResolutionViewState {
	switch (action.type) {
		case "expand":
			return {
				isExpanded: true,
				activeVersionId: action.activeVersionId,
				storageMode: "preserve",
				showFileChanges: false,
			};
		case "collapse":
			return INITIAL_SKILL_RESOLUTION_VIEW;
		case "set-active-version":
			return {
				...state,
				activeVersionId: action.activeVersionId,
			};
		case "set-storage-mode":
			return { ...state, storageMode: action.storageMode };
		case "set-file-changes":
			return { ...state, showFileChanges: action.showFileChanges };
	}
}
