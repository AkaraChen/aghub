import {
	CodeBracketIcon,
	DocumentDuplicateIcon,
	LinkIcon,
} from "@heroicons/react/24/solid";
import { useTranslation } from "react-i18next";
import { AgentIcons } from "./agent-icons";
import type { SkillVersionChoiceLocation } from "./skill-copy-versions";

export function SkillVersionSources({
	locations,
}: {
	locations: SkillVersionChoiceLocation[];
}) {
	const agentItems = locations.flatMap((location) =>
		(location.agents ?? (location.sourceId ? [location.sourceId] : [])).map(
			(agent) => ({ agent }),
		),
	);
	const repository = locations.find(
		(location) => location.kind === "repository",
	);
	const fallbackSource = locations.find(
		(location) =>
			location.kind !== "repository" &&
			!location.sourceId &&
			!location.agents?.length,
	);

	return (
		<div className="flex min-h-5 min-w-0 items-center gap-2">
			{repository && (
				<span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-foreground">
					<CodeBracketIcon className="size-4 shrink-0 text-muted" />
					<span className="truncate">{repository.source}</span>
				</span>
			)}
			{agentItems.length > 0 && (
				<>
					<AgentIcons items={agentItems} overflowVariant="square" />
					{locations.length === 1 && (
						<span className="truncate text-xs font-medium text-foreground">
							{locations[0]?.source}
						</span>
					)}
				</>
			)}
			{fallbackSource && (
				<span className="truncate text-xs font-medium text-foreground">
					{fallbackSource.source}
				</span>
			)}
		</div>
	);
}

export function SkillVersionLocations({
	locations,
}: {
	locations: SkillVersionChoiceLocation[];
}) {
	const { t } = useTranslation();
	return (
		<div className="min-w-0 divide-y divide-separator/70 rounded-md border border-separator/70 bg-surface-secondary/40 px-3">
			{locations.map((location) => {
				const RelationshipIcon =
					location.kind === "repository"
						? CodeBracketIcon
						: location.kind === "symlink"
							? LinkIcon
							: DocumentDuplicateIcon;
				const relationship = t(
					location.kind === "repository"
						? "skillVersionRepositorySource"
						: location.kind === "symlink"
							? "skillVersionSymlink"
							: "skillVersionIndependentCopy",
				);

				return (
					<div
						key={`${location.source}:${location.path}`}
						data-skill-version-location=""
						className="min-w-0 py-2"
					>
						<code className="block whitespace-normal break-all text-[11px] leading-5 text-foreground">
							{location.path}
						</code>
						<div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted">
							<span className="inline-flex shrink-0 items-center gap-1">
								<RelationshipIcon className="size-3" />
								{relationship}
								{location.target ? ` → ${location.target}` : ""}
							</span>
							<span aria-hidden className="text-separator">
								·
							</span>
							<span className="min-w-0 break-words">
								{location.source}
							</span>
						</div>
					</div>
				);
			})}
		</div>
	);
}
