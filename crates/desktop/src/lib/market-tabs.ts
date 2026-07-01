import {
	CodeBracketIcon,
	PuzzlePieceIcon,
	ServerIcon,
	SparklesIcon,
} from "@heroicons/react/24/solid";
import type { ComponentType, SVGProps } from "react";

export const MARKET_TAB_IDS = [
	"skills-sh",
	"mcp",
	"claude-plugins",
	"github",
] as const;

export type MarketTabId = (typeof MARKET_TAB_IDS)[number];

export const DEFAULT_MARKET_TAB: MarketTabId = "skills-sh";

export interface MarketTabDefinition {
	id: MarketTabId;
	labelKey: string;
	icon: ComponentType<SVGProps<SVGSVGElement>>;
}

export const MARKET_TABS: MarketTabDefinition[] = [
	{ id: "skills-sh", labelKey: "marketTabSkillsSh", icon: SparklesIcon },
	{ id: "mcp", labelKey: "marketTabMcp", icon: ServerIcon },
	{
		id: "claude-plugins",
		labelKey: "marketTabClaudePlugins",
		icon: PuzzlePieceIcon,
	},
	{ id: "github", labelKey: "marketTabGithub", icon: CodeBracketIcon },
];

export function isMarketTabId(value: string | null): value is MarketTabId {
	return MARKET_TAB_IDS.includes(value as MarketTabId);
}

export function resolveMarketTab(value: string | null): MarketTabId {
	return isMarketTabId(value) ? value : DEFAULT_MARKET_TAB;
}
