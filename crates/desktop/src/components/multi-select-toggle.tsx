import { CheckCircleIcon, RectangleStackIcon } from "@heroicons/react/24/solid";
import { Button, Tooltip } from "@heroui/react";
import { useTranslation } from "react-i18next";
import { cn } from "../lib/utils";

interface MultiSelectToggleProps {
	isActive: boolean;
	onToggle: () => void;
}

/** The toolbar switch for multi-select mode, shared by the resource lists. */
export function MultiSelectToggle({
	isActive,
	onToggle,
}: MultiSelectToggleProps) {
	const { t } = useTranslation();
	const label = isActive ? t("doneSelecting") : t("multiSelect");
	return (
		<Tooltip delay={0}>
			<Button
				isIconOnly
				variant="ghost"
				size="sm"
				className={cn(
					"shrink-0 text-muted",
					isActive && "bg-accent/10 text-accent",
				)}
				aria-label={label}
				onPress={onToggle}
			>
				{isActive ? (
					<CheckCircleIcon className="size-4" />
				) : (
					<RectangleStackIcon className="size-4" />
				)}
			</Button>
			<Tooltip.Content>{label}</Tooltip.Content>
		</Tooltip>
	);
}
