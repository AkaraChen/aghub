import { StarIcon as StarIconOutline } from "@heroicons/react/24/outline";
import {
	ArrowsRightLeftIcon,
	FolderIcon,
	FolderMinusIcon,
	FolderPlusIcon,
	PlusIcon,
	StarIcon as StarIconSolid,
	TrashIcon,
} from "@heroicons/react/24/solid";
import type { ComponentType, SVGProps } from "react";

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

/**
 * Single source for resource-action icons, so every entry point (context
 * menu, bulk panel, and future ones) renders the same glyph per action.
 * favorite/unfavorite are split because the star's fill flips with state.
 */
export const ACTION_ICONS = {
	favorite: StarIconSolid,
	unfavorite: StarIconOutline,
	addToAgent: PlusIcon,
	transfer: ArrowsRightLeftIcon,
	moveToGroup: FolderIcon,
	createGroup: FolderPlusIcon,
	removeFromGroup: FolderMinusIcon,
	delete: TrashIcon,
} satisfies Record<string, IconComponent>;
