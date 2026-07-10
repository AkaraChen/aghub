import {
	BookOpenIcon,
	CheckCircleIcon,
	ChevronRightIcon,
	LinkIcon,
} from "@heroicons/react/24/solid";
import { Button, Spinner, Tooltip } from "@heroui/react";
import githubIcon from "@lobehub/icons-static-svg/icons/github.svg?raw";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useApi } from "../hooks/use-api";
import { cn } from "../lib/utils";
import { skillTreeQueryOptions } from "../requests/skills";
import { SkillTree } from "./skill-detail-views";

export interface SourceMember {
	name: string;
	/** The skill's on-disk location, for the structure tree */
	path: string | null;
}

interface SourceDetailPanelProps {
	/** The source id, e.g. github/AkaraChen/web-dev */
	title: string;
	url: string | null;
	sourceType: string | null;
	/** Member skills, in list order */
	members: SourceMember[];
	/** Selects the whole library (opens the batch inspector) */
	onSelectAll: () => void;
	/** Selects one member (jumps to its detail) */
	onSelectMember: (name: string) => void;
}

/**
 * The library page: shown when a source cluster row is clicked. A source
 * is provenance, so its page is read-mostly — where it came from, what
 * it contains and how each skill is laid out on disk — with one primary
 * action: select the whole library.
 */
export function SourceDetailPanel({
	title,
	url,
	sourceType,
	members,
	onSelectAll,
	onSelectMember,
}: SourceDetailPanelProps) {
	const { t } = useTranslation();

	return (
		<div className="flex h-full flex-col">
			<header className="flex shrink-0 items-start justify-between gap-3 border-b border-separator p-4">
				<div className="min-w-0 flex-1">
					<h2 className="truncate text-lg font-semibold text-foreground">
						{title}
					</h2>
					<p className="mt-1 text-sm text-muted">
						{t("memberCount", { count: members.length })}
					</p>
				</div>
				{url && (
					<Tooltip delay={0}>
						<Button
							isIconOnly
							variant="ghost"
							size="md"
							className="min-h-[44px] min-w-[44px] text-muted hover:text-foreground"
							aria-label={t("openInBrowser")}
							onPress={() => void openUrl(url)}
						>
							{sourceType === "github" ? (
								<span
									className="inline-flex size-5 shrink-0 items-center [&_svg]:size-full [&_svg]:fill-current"
									// eslint-disable-next-line @eslint-react/dom-no-dangerously-set-innerhtml
									dangerouslySetInnerHTML={{
										__html: githubIcon,
									}}
								/>
							) : (
								<LinkIcon className="size-5" />
							)}
						</Button>
						<Tooltip.Content>{t("openInBrowser")}</Tooltip.Content>
					</Tooltip>
				)}
			</header>

			<div className="flex-1 overflow-y-auto p-4">
				<ul className="space-y-0.5">
					{members.map((member) => (
						<MemberRow
							key={member.name}
							member={member}
							onSelect={() => onSelectMember(member.name)}
						/>
					))}
				</ul>
			</div>

			<footer className="shrink-0 border-t border-separator p-4">
				<Button
					variant="secondary"
					className="w-full"
					onPress={onSelectAll}
				>
					<CheckCircleIcon className="size-4" />
					{t("selectWholeLibrary")}
				</Button>
			</footer>
		</div>
	);
}

function MemberRow({
	member,
	onSelect,
}: {
	member: SourceMember;
	onSelect: () => void;
}) {
	const { t } = useTranslation();
	const api = useApi();
	const [isOpen, setIsOpen] = useState(false);

	const { data: tree, isLoading } = useQuery({
		...skillTreeQueryOptions({
			api,
			path: member.path ?? undefined,
			enabled: isOpen && Boolean(member.path),
		}),
	});

	return (
		<li>
			<div className="group flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors duration-[var(--dur-fast)] hover:bg-default">
				<BookOpenIcon className="size-4 shrink-0 text-muted" />
				<button
					type="button"
					onClick={onSelect}
					className="min-w-0 flex-1 truncate text-left"
				>
					{member.name}
				</button>
				{member.path && (
					<button
						type="button"
						aria-label={t("viewStructure", { name: member.name })}
						aria-expanded={isOpen}
						onClick={() => setIsOpen((prev) => !prev)}
						className="flex size-5 shrink-0 items-center justify-center rounded text-muted transition-colors hover:text-foreground"
					>
						<ChevronRightIcon
							className={cn(
								"size-3.5 transition-transform duration-[var(--dur-fast)] ease-[var(--ease-out)]",
								isOpen && "rotate-90",
							)}
						/>
					</button>
				)}
			</div>
			{isOpen && (
				<div className="mt-1 mb-2 ml-8">
					{isLoading ? (
						<Spinner size="sm" color="current" />
					) : tree ? (
						<SkillTree root={tree} />
					) : null}
				</div>
			)}
		</li>
	);
}
