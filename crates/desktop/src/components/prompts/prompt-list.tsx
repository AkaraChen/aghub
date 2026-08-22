import { DocumentTextIcon } from "@heroicons/react/24/solid";
import { Chip, ListBox } from "@heroui/react";
import { useTranslation } from "react-i18next";
import type { PromptResponse } from "../../generated/dto";

interface PromptListProps {
	prompts: PromptResponse[];
	selectedId: string | null;
	hasFilter: boolean;
	onSelect: (id: string) => void;
}

export function PromptList({
	prompts,
	selectedId,
	hasFilter,
	onSelect,
}: PromptListProps) {
	const { t } = useTranslation();
	const selectedKeys =
		selectedId && prompts.some((prompt) => prompt.id === selectedId)
			? new Set([selectedId])
			: new Set<string>();

	if (prompts.length === 0) {
		return (
			<div className="flex h-full flex-col items-center justify-center gap-3 p-6">
				<DocumentTextIcon className="size-8 text-muted" />
				<p className="text-center text-sm font-medium text-foreground">
					{hasFilter ? t("noPromptsMatch") : t("noPrompts")}
				</p>
				{!hasFilter && (
					<p className="text-center text-sm text-muted">
						{t("noPromptsDescription")}
					</p>
				)}
			</div>
		);
	}

	return (
		<ListBox
			aria-label={t("prompts")}
			selectionMode="single"
			selectionBehavior="replace"
			selectedKeys={selectedKeys}
			onSelectionChange={(keys) => {
				if (keys === "all") return;
				const key = [...keys][0] as string | undefined;
				if (key) onSelect(key);
			}}
			className="p-2"
		>
			{prompts.map((prompt) => (
				<ListBox.Item
					key={prompt.id}
					id={prompt.id}
					textValue={prompt.title}
					className="transition-colors duration-150 motion-reduce:transition-none data-[hovered=true]:bg-default data-[selected=true]:bg-surface data-[hovered=true]:data-[selected=true]:bg-default"
				>
					<div className="flex w-full flex-col gap-1 overflow-hidden">
						<div className="flex min-w-0 items-baseline gap-2">
							<span className="min-w-0 truncate font-medium">
								{prompt.title}
							</span>
							{prompt.category && (
								<span className="shrink-0 text-xs text-muted">
									{prompt.category}
								</span>
							)}
						</div>
						{prompt.description && (
							<p className="truncate text-xs text-muted">
								{prompt.description}
							</p>
						)}
						{prompt.tags.length > 0 && (
							<div className="flex flex-wrap gap-1">
								{prompt.tags.slice(0, 3).map((tag) => (
									<Chip
										key={tag}
										size="sm"
										variant="soft"
										color="default"
									>
										{tag}
									</Chip>
								))}
							</div>
						)}
					</div>
				</ListBox.Item>
			))}
		</ListBox>
	);
}
