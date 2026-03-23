import { Chip } from "@heroui/react";
import type { ReactNode } from "react";

interface ResourceSectionHeaderProps {
	title: string;
	count: number;
	icon: ReactNode;
}

export function ResourceSectionHeader({
	title,
	count,
	icon,
}: ResourceSectionHeaderProps) {
	return (
		<div className="flex items-center gap-2 px-3 py-2 text-xs font-medium text-muted uppercase tracking-wide border-b border-border bg-surface-secondary">
			{icon}
			<span className="flex-1">{title}</span>
			{count > 0 && (
				<Chip size="sm" variant="soft" color="accent">
					{count}
				</Chip>
			)}
		</div>
	);
}