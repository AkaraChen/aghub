"use client";

import { ToggleButton, ToggleButtonGroup } from "@heroui/react";

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
			<ToggleButtonGroup
				className="min-w-max"
				size="sm"
				selectionMode="single"
				disallowEmptySelection
				selectedKeys={[selectedCategory ?? "__all__"]}
				onSelectionChange={(keys) => {
					const nextKey = [...keys][0] as string | undefined;
					onSelect(nextKey && nextKey !== "__all__" ? nextKey : null);
				}}
			>
				<ToggleButton
					id="__all__"
					variant="ghost"
					className="bg-surface-secondary text-muted data-[selected=true]:bg-accent/10 data-[selected=true]:text-accent"
				>
					{allLabel}
				</ToggleButton>
				{categories.map((category) => (
					<ToggleButton
						key={category}
						id={category}
						variant="ghost"
						className="bg-surface-secondary text-muted data-[selected=true]:bg-accent/10 data-[selected=true]:text-accent"
					>
						{getCategoryLabel(category)}
					</ToggleButton>
				))}
			</ToggleButtonGroup>
		</div>
	);
}
