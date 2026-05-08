import { ChevronDownIcon, ChevronUpIcon } from "@heroicons/react/24/solid";
import { Button, Card, Checkbox, Tooltip, toast } from "@heroui/react";
import { useTranslation } from "react-i18next";
import { useSidebarNavigation } from "../../hooks/use-sidebar-navigation";
import type { SidebarItemId } from "../../lib/store";

export default function SidebarPanel() {
	const { t } = useTranslation();
	const {
		moveItem,
		resetSidebarItems,
		resolvedSidebarItems,
		setItemVisibility,
		visibleSidebarItems,
	} = useSidebarNavigation();

	const visibleCount = visibleSidebarItems.length;

	const handleVisibilityChange = async (
		id: SidebarItemId,
		visible: boolean,
	) => {
		try {
			await setItemVisibility(id, visible);
		} catch {
			toast.danger(t("sidebarSaveError"));
		}
	};

	const handleMove = async (id: SidebarItemId, direction: "up" | "down") => {
		try {
			await moveItem(id, direction);
		} catch {
			toast.danger(t("sidebarSaveError"));
		}
	};

	const handleReset = async () => {
		try {
			await resetSidebarItems();
		} catch {
			toast.danger(t("sidebarResetError"));
		}
	};

	return (
		<Card className="p-0">
			<Card.Content className="space-y-4 p-4">
				<div className="flex items-center justify-between gap-4">
					<div className="space-y-0.5">
						<span className="text-sm font-medium text-(--foreground)">
							{t("sidebar")}
						</span>
						<span className="block text-xs text-muted">
							{t("sidebarDescription")}
						</span>
					</div>
					<Button
						variant="secondary"
						size="sm"
						onPress={() => void handleReset()}
					>
						{t("resetSidebar")}
					</Button>
				</div>

				<div className="space-y-2">
					{resolvedSidebarItems.map((item, index) => {
						const Icon = item.icon;
						const isOnlyVisibleItem =
							item.visible && visibleCount === 1;

						return (
							<div
								key={item.id}
								className="
									flex items-center gap-3 rounded-lg border
									border-border bg-surface-secondary px-3 py-2
								"
							>
								<Checkbox
									value={item.id}
									isSelected={item.visible}
									isDisabled={isOnlyVisibleItem}
									onChange={(isSelected) => {
										void handleVisibilityChange(
											item.id,
											isSelected,
										);
									}}
									variant="secondary"
									className="min-w-0 flex-1"
								>
									<Checkbox.Control>
										<Checkbox.Indicator />
									</Checkbox.Control>
									<Checkbox.Content className="min-w-0">
										<div className="flex items-center gap-2">
											<Icon className="size-4 text-muted" />
											<span
												className="
													text-sm font-medium
													text-(--foreground)
												"
											>
												{t(item.labelKey)}
											</span>
										</div>
										<span className="block text-xs text-muted">
											{item.href}
										</span>
									</Checkbox.Content>
								</Checkbox>

								<div className="flex items-center gap-1">
									<Tooltip delay={0}>
										<Button
											isIconOnly
											variant="ghost"
											size="sm"
											aria-label={t("moveSidebarItemUp", {
												name: t(item.labelKey),
											})}
											isDisabled={index === 0}
											onPress={() =>
												void handleMove(item.id, "up")
											}
										>
											<ChevronUpIcon className="size-4" />
										</Button>
										<Tooltip.Content>
											{t("moveUp")}
										</Tooltip.Content>
									</Tooltip>

									<Tooltip delay={0}>
										<Button
											isIconOnly
											variant="ghost"
											size="sm"
											aria-label={t(
												"moveSidebarItemDown",
												{
													name: t(item.labelKey),
												},
											)}
											isDisabled={
												index ===
												resolvedSidebarItems.length - 1
											}
											onPress={() =>
												void handleMove(item.id, "down")
											}
										>
											<ChevronDownIcon className="size-4" />
										</Button>
										<Tooltip.Content>
											{t("moveDown")}
										</Tooltip.Content>
									</Tooltip>
								</div>
							</div>
						);
					})}
				</div>

				<p className="text-xs text-muted">
					{t("sidebarMinimumVisibleHint")}
				</p>
			</Card.Content>
		</Card>
	);
}
