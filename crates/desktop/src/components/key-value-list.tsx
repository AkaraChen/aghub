"use client";

import { ChevronDownIcon, ChevronUpIcon } from "@heroicons/react/24/solid";

interface KeyValueListProps {
	items: Array<[string, string]>;
	collapsedCount?: number;
	showAll: boolean;
	onToggle: () => void;
	showMoreLabel: (count: number) => string;
	showLessLabel: string;
}

export function KeyValueList({
	items,
	collapsedCount = 2,
	showAll,
	onToggle,
	showMoreLabel,
	showLessLabel,
}: KeyValueListProps) {
	const displayedItems =
		showAll || items.length <= collapsedCount
			? items
			: items.slice(0, collapsedCount);
	const hiddenCount = Math.max(items.length - collapsedCount, 0);

	return (
		<div className="grid gap-1.5">
			<div className="space-y-2">
				{displayedItems.map(([key, value]) => (
					<div
						key={key}
						className="grid gap-1 rounded-lg border border-separator bg-surface-secondary px-3 py-2"
					>
						<span className="font-mono text-[11px] text-muted">
							{key}
						</span>
						<code className="font-mono text-xs leading-5 text-foreground break-words">
							{value}
						</code>
					</div>
				))}
			</div>
			{hiddenCount > 0 && (
				<button
					type="button"
					onClick={onToggle}
					className="flex items-center gap-1 text-xs text-muted transition-colors hover:text-foreground"
				>
					{showAll ? (
						<>
							<ChevronUpIcon className="size-3.5" />
							<span>{showLessLabel}</span>
						</>
					) : (
						<>
							<ChevronDownIcon className="size-3.5" />
							<span>{showMoreLabel(hiddenCount)}</span>
						</>
					)}
				</button>
			)}
		</div>
	);
}
