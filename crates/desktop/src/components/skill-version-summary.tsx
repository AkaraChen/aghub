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
	if (locations.length > 1) {
		const repositoryCount = locations.filter(
			(location) => location.kind === "repository",
		).length;
		const symlinkCount = locations.filter(
			(location) => location.kind === "symlink",
		).length;
		const copyCount = locations.filter(
			(location) => location.kind === "copy",
		).length;
		const relationships = [
			repositoryCount > 0
				? t("skillVersionRepositoryCount", {
						count: repositoryCount,
					})
				: null,
			symlinkCount > 0
				? t("skillVersionSymlinkCount", { count: symlinkCount })
				: null,
			copyCount > 0
				? t("skillVersionCopyCount", { count: copyCount })
				: null,
		].filter((relationship): relationship is string =>
			Boolean(relationship),
		);

		return (
			<div className="min-w-0">
				<span className="sr-only">
					{locations.map((location) => location.path).join(", ")}
				</span>
				<span className="block truncate text-xs font-medium text-foreground">
					{t("skillVersionLocationCount", {
						count: locations.length,
					})}
				</span>
				<span className="mt-0.5 block truncate text-[11px] text-muted">
					{relationships.join(" · ")}
				</span>
			</div>
		);
	}

	return (
		<div className="space-y-2">
			{locations.map((location) => (
				<div
					key={`${location.source}:${location.path}`}
					className="min-w-0"
				>
					<code className="block truncate text-[11px] text-foreground">
						{location.path}
					</code>
					<span className="mt-0.5 flex min-w-0 items-center gap-1 text-[11px] text-muted">
						{location.kind === "symlink" ? (
							<LinkIcon className="size-3 shrink-0" />
						) : (
							<DocumentDuplicateIcon className="size-3 shrink-0" />
						)}
						<span className="truncate">
							{t(
								location.kind === "repository"
									? "skillVersionRepositorySource"
									: location.kind === "symlink"
										? "skillVersionSymlink"
										: "skillVersionIndependentCopy",
							)}
							{location.target ? ` → ${location.target}` : ""}
						</span>
					</span>
				</div>
			))}
		</div>
	);
}
