import { Button, Card, Checkbox, toast } from "@heroui/react";
import { useTranslation } from "react-i18next";
import { useSidebarNavigation } from "../../hooks/use-sidebar-navigation";
import type { SidebarItemId } from "../../lib/store";

export default function SidebarPanel() {
	const { t } = useTranslation();
	const {
		isHydrating,
		isSaving,
		resetSidebarItems,
		resolvedSidebarSections,
		setItemVisibility,
	} = useSidebarNavigation();
	const allItemsVisible = resolvedSidebarSections.every((section) =>
		section.items.every((item) => item.visible),
	);

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

	const handleReset = async () => {
		try {
			await resetSidebarItems();
		} catch {
			toast.danger(t("sidebarResetError"));
		}
	};

	return (
		<Card
			role="group"
			aria-labelledby="sidebar-visibility-heading"
			aria-busy={isHydrating || isSaving}
			className="p-0"
		>
			<Card.Content className="space-y-5 p-4">
				<div className="flex items-start justify-between gap-4">
					<div className="space-y-0.5">
						<h3
							id="sidebar-visibility-heading"
							className="text-sm font-medium text-(--foreground)"
						>
							{t("sidebar")}
						</h3>
						<p className="text-xs text-muted">
							{t("sidebarDescription")}
						</p>
					</div>
					<Button
						variant="secondary"
						size="sm"
						isDisabled={isHydrating || isSaving || allItemsVisible}
						onPress={() => void handleReset()}
					>
						{t("resetSidebar")}
					</Button>
				</div>

				<div className="space-y-5">
					{resolvedSidebarSections.map((section) => (
						<section
							key={section.id}
							aria-labelledby={`sidebar-${section.id}-heading`}
							className="space-y-2"
						>
							<h4
								id={`sidebar-${section.id}-heading`}
								className="px-0.5 text-xs font-medium text-muted"
							>
								{t(section.labelKey)}
							</h4>
							<div className="grid gap-2 sm:grid-cols-2">
								{section.items.map((item) => {
									const Icon = item.icon;

									return (
										<Checkbox
											key={item.id}
											value={item.id}
											isSelected={item.visible}
											isDisabled={isHydrating || isSaving}
											onChange={(visible) =>
												void handleVisibilityChange(
													item.id,
													visible,
												)
											}
											variant="secondary"
											className="w-full"
										>
											<Checkbox.Content className="w-full items-center gap-3 rounded-lg border border-border bg-surface-secondary px-3 py-2.5">
												<Checkbox.Control>
													<Checkbox.Indicator />
												</Checkbox.Control>
												<span className="flex min-w-0 items-center gap-2">
													<Icon className="size-4 shrink-0 text-muted" />
													<span className="truncate text-sm font-medium text-(--foreground)">
														{t(item.labelKey)}
													</span>
												</span>
											</Checkbox.Content>
										</Checkbox>
									);
								})}
							</div>
						</section>
					))}
				</div>
			</Card.Content>
		</Card>
	);
}
