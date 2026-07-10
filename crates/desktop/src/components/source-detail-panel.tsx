import {
	BookOpenIcon,
	CheckCircleIcon,
	LinkIcon,
} from "@heroicons/react/24/solid";
import { Button, Tooltip } from "@heroui/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";

interface SourceDetailPanelProps {
	/** The source id, e.g. github/AkaraChen/web-dev */
	title: string;
	url: string | null;
	/** Member skill names, in list order */
	members: string[];
	/** Selects the whole library (opens the batch inspector) */
	onSelectAll: () => void;
	/** Selects one member (jumps to its detail) */
	onSelectMember: (name: string) => void;
}

/**
 * The library page: shown when a source cluster row is clicked. A source
 * is provenance, so its page is read-mostly — where it came from, what
 * it contains — with one primary action: select the whole library.
 */
export function SourceDetailPanel({
	title,
	url,
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
							<LinkIcon className="size-5" />
						</Button>
						<Tooltip.Content>{t("openInBrowser")}</Tooltip.Content>
					</Tooltip>
				)}
			</header>

			<div className="flex-1 overflow-y-auto p-4">
				<ul className="space-y-0.5">
					{members.map((name) => (
						<li key={name}>
							<button
								type="button"
								onClick={() => onSelectMember(name)}
								className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors duration-[var(--dur-fast)] hover:bg-default"
							>
								<BookOpenIcon className="size-4 shrink-0 text-muted" />
								<span className="min-w-0 flex-1 truncate">
									{name}
								</span>
							</button>
						</li>
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
