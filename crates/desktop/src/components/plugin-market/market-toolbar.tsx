import { ArrowPathIcon } from "@heroicons/react/24/solid";
import { Button, ListBox, SearchField, Select } from "@heroui/react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { cn } from "../../lib/utils";
import { MarketplacesPanel } from "./marketplaces-panel";

interface PluginMarketToolbarProps {
	searchQuery: string;
	onSearchChange: (value: string) => void;
	selectedCategory: string | null;
	onCategoryChange: (value: string | null) => void;
	categories: string[];
	getCategoryLabel: (category: string) => string;
	isRefreshing: boolean;
	onRefresh: () => void;
	installScope: "global" | "project" | "local";
	showNavigation: boolean;
}

export function PluginMarketToolbar({
	searchQuery,
	onSearchChange,
	selectedCategory,
	onCategoryChange,
	categories,
	getCategoryLabel,
	isRefreshing,
	onRefresh,
	installScope,
	showNavigation,
}: PluginMarketToolbarProps) {
	const { t } = useTranslation();
	const [, setLocation] = useLocation();
	return (
		<div className="flex shrink-0 flex-wrap items-center gap-2">
			<SearchField
				variant="secondary"
				value={searchQuery}
				onChange={onSearchChange}
				aria-label={t("searchPlugins")}
				className="min-w-0 flex-[1_1_12rem]"
			>
				<SearchField.Group>
					<SearchField.SearchIcon />
					<SearchField.Input placeholder={t("searchPlugins")} />
					<SearchField.ClearButton />
				</SearchField.Group>
			</SearchField>
			<Select
				variant="secondary"
				aria-label={t("pluginMarketCategory")}
				selectedKey={selectedCategory ?? "__all__"}
				onSelectionChange={(key) =>
					onCategoryChange(key === "__all__" ? null : String(key))
				}
				className="w-32 shrink-0"
			>
				<Select.Trigger>
					<Select.Value />
					<Select.Indicator />
				</Select.Trigger>
				<Select.Popover>
					<ListBox>
						<ListBox.Item id="__all__" textValue={t("all")}>
							{t("all")}
						</ListBox.Item>
						{categories.map((category) => (
							<ListBox.Item
								key={category}
								id={category}
								textValue={getCategoryLabel(category)}
							>
								{getCategoryLabel(category)}
							</ListBox.Item>
						))}
					</ListBox>
				</Select.Popover>
			</Select>
			{showNavigation && (
				<>
					<MarketplacesPanel
						installScope={installScope}
						isDisabled={isRefreshing}
					/>
					<Button
						variant="secondary"
						onPress={() => setLocation("/cc-plugins")}
					>
						{t("viewInstalledPlugins")}
					</Button>
				</>
			)}
			<Button
				variant="secondary"
				isPending={isRefreshing}
				onPress={onRefresh}
			>
				{({ isPending }) => (
					<>
						<ArrowPathIcon
							className={cn(
								"size-4",
								isPending && "motion-safe:animate-spin",
							)}
						/>
						{t("updateMarketplace")}
					</>
				)}
			</Button>
		</div>
	);
}
