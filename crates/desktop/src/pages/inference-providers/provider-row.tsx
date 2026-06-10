import { QuestionMarkCircleIcon, ServerIcon } from "@heroicons/react/24/solid";
import { Chip, Label, ListBox, Select, Tooltip } from "@heroui/react";
import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

interface ProviderModelOption {
	id: string;
	name?: string | null;
}

export function ProviderActiveBadge({
	children,
	icon,
}: {
	children: ReactNode;
	icon?: ReactNode;
}) {
	return (
		<Chip size="sm" variant="tertiary" color="accent">
			{icon}
			{children}
		</Chip>
	);
}

export function ProviderRowShell({
	title,
	titleExtras,
	description,
	descriptionTooltip,
	leadingIcon,
	actions,
	actionsClassName,
	isActive,
	className,
}: {
	title: ReactNode;
	titleExtras?: ReactNode;
	description?: ReactNode;
	descriptionTooltip?: string;
	leadingIcon?: ReactNode;
	actions?: ReactNode;
	actionsClassName?: string;
	isActive?: boolean;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"grid gap-3 rounded-lg px-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center",
				isActive && "bg-surface-secondary",
				className,
			)}
		>
			<div className="grid min-w-0 gap-1">
				<div className="flex min-w-0 items-center gap-2">
					{leadingIcon ?? (
						<ServerIcon className="size-4 shrink-0 text-muted" />
					)}
					<Label className="truncate">{title}</Label>
					{titleExtras}
				</div>
				{description && (
					<div className="flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
						<span className="inline-flex min-w-0 items-center gap-1">
							{description}
							{descriptionTooltip && (
								<Tooltip delay={0}>
									<Tooltip.Trigger>
										<span
											tabIndex={0}
											aria-label={descriptionTooltip}
											className="inline-flex size-4 shrink-0 items-center justify-center text-muted"
										>
											<QuestionMarkCircleIcon className="size-4" />
										</span>
									</Tooltip.Trigger>
									<Tooltip.Content className="max-w-64">
										{descriptionTooltip}
									</Tooltip.Content>
								</Tooltip>
							)}
						</span>
					</div>
				)}
			</div>

			{actions && (
				<div
					className={cn(
						"flex items-center gap-1 sm:justify-end",
						actionsClassName,
					)}
				>
					{actions}
				</div>
			)}
		</div>
	);
}

export function ProviderModelSelect({
	models,
	selectedModel,
	label,
	isDisabled,
	onSelect,
}: {
	models: ProviderModelOption[];
	selectedModel?: string | null;
	label: string;
	isDisabled?: boolean;
	onSelect: (model: string) => void;
}) {
	if (models.length === 0) {
		return null;
	}

	const hasSelectedModel =
		selectedModel && models.some((model) => model.id === selectedModel);
	const options =
		selectedModel && !hasSelectedModel
			? [{ id: selectedModel, name: selectedModel }, ...models]
			: models;
	const selectedKey = selectedModel ?? options[0]?.id;

	return (
		<Select
			aria-label={label}
			className="min-w-44 sm:w-56"
			selectedKey={selectedKey}
			isDisabled={isDisabled}
			onSelectionChange={(key) => {
				if (!key) return;
				onSelect(String(key));
			}}
			variant="secondary"
		>
			<Select.Trigger className="h-9 min-h-9">
				<Select.Value />
				<Select.Indicator />
			</Select.Trigger>
			<Select.Popover>
				<ListBox>
					{options.map((model) => (
						<ListBox.Item
							key={model.id}
							id={model.id}
							textValue={model.name ?? model.id}
						>
							<Label className="truncate">
								{model.name ?? model.id}
							</Label>
						</ListBox.Item>
					))}
				</ListBox>
			</Select.Popover>
		</Select>
	);
}
