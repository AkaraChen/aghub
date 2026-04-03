import { TrashIcon } from "@heroicons/react/24/solid";
import { Button } from "@heroui/react";
import { useTranslation } from "react-i18next";

interface MultiSelectFloatingBarProps {
	selectedCount: number;
	totalCount: number;
	onDelete: () => void;
}

export function MultiSelectFloatingBar({
	selectedCount,
	totalCount,
	onDelete,
}: MultiSelectFloatingBarProps) {
	const { t } = useTranslation();

	if (selectedCount === 0) {
		return null;
	}

	return (
		<div className="pointer-events-none absolute bottom-6 left-1/2 z-50 -translate-x-1/2 animate-in slide-in-from-bottom-4 fade-in duration-200 ease-out fill-mode-both">
			<div className="flex items-center justify-between gap-4 px-10 py-3 bg-background/95 backdrop-blur-sm border border-separator rounded-full shadow-lg min-w-[200px]">
				<span className="text-sm font-medium text-foreground">
					{selectedCount}/{totalCount}
				</span>
				<Button
					variant="danger"
					size="sm"
					onPress={onDelete}
					className="pointer-events-auto min-h-[32px]"
				>
					<TrashIcon className="size-4 mr-1.5" />
					{t("deleteSelected")}
				</Button>
			</div>
		</div>
	);
}
