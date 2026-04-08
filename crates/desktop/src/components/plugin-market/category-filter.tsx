"use client";

import { cn } from "../../lib/utils";

interface CategoryFilterProps {
	categories: string[];
	selectedCategory: string | null;
	onSelect: (category: string | null) => void;
	getCategoryLabel: (category: string) => string;
	allLabel: string;
}

export function CategoryFilter({
	categories,
	selectedCategory,
	onSelect,
	getCategoryLabel,
	allLabel,
}: CategoryFilterProps) {
	if (categories.length === 0) {
		return null;
	}

	return (
		<div className="shrink-0 overflow-x-auto pb-1">
			<div className="flex min-w-max gap-1.5">
				<button
					type="button"
					onClick={() => onSelect(null)}
					className={cn(
						"shrink-0 rounded-full px-3 py-1.5 text-[11px] font-medium tracking-wide transition-colors cursor-pointer",
						selectedCategory === null
							? "bg-accent/10 text-accent"
							: "bg-surface-secondary hover:bg-surface-tertiary text-muted hover:text-foreground",
					)}
				>
					{allLabel}
				</button>
				{categories.map((category) => (
					<button
						key={category}
						type="button"
						onClick={() => onSelect(category)}
						className={cn(
							"shrink-0 rounded-full px-3 py-1.5 text-[11px] font-medium tracking-wide transition-colors cursor-pointer",
							selectedCategory === category
								? "bg-accent/10 text-accent"
								: "bg-surface-secondary hover:bg-surface-tertiary text-muted hover:text-foreground",
						)}
					>
						{getCategoryLabel(category)}
					</button>
				))}
			</div>
		</div>
	);
}
