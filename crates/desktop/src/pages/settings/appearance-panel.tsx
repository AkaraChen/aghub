import {
	ComputerDesktopIcon,
	MoonIcon,
	SunIcon,
} from "@heroicons/react/24/solid";
import {
	Card,
	ListBox,
	Select,
	ToggleButton,
	ToggleButtonGroup,
} from "@heroui/react";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../hooks/use-theme";
import SidebarPanel from "./sidebar-panel";

export default function AppearancePanel() {
	const { t, i18n } = useTranslation();
	const { theme, setTheme } = useTheme();

	const changeLanguage = (lng: string) => {
		void i18n.changeLanguage(lng);
	};

	return (
		<div className="space-y-4">
			<Card className="p-0">
				<Card.Content className="space-y-4 p-4">
					<div className="flex items-center justify-between">
						<div className="space-y-0.5">
							<span className="text-sm font-medium text-(--foreground)">
								{t("theme")}
							</span>
							<span className="block text-xs text-muted">
								{t("themeDescription")}
							</span>
						</div>
						<ToggleButtonGroup
							selectedKeys={[theme]}
							onSelectionChange={(keys) =>
								setTheme(
									[...keys][0] as "light" | "dark" | "system",
								)
							}
							selectionMode="single"
							disallowEmptySelection
							size="sm"
						>
							<ToggleButton id="light" aria-label={t("light")}>
								<SunIcon className="size-4" />
								{t("light")}
							</ToggleButton>
							<ToggleButton id="dark" aria-label={t("dark")}>
								<ToggleButtonGroup.Separator />
								<MoonIcon className="size-4" />
								{t("dark")}
							</ToggleButton>
							<ToggleButton id="system" aria-label={t("system")}>
								<ToggleButtonGroup.Separator />
								<ComputerDesktopIcon className="size-4" />
								{t("system")}
							</ToggleButton>
						</ToggleButtonGroup>
					</div>

					<div className="flex items-center justify-between">
						<div className="space-y-0.5">
							<span className="text-sm font-medium text-(--foreground)">
								{t("language")}
							</span>
							<span className="block text-xs text-muted">
								{t("languageDescription")}
							</span>
						</div>
						<Select
							variant="secondary"
							value={i18n.resolvedLanguage ?? i18n.language}
							onChange={(key) => changeLanguage(key as string)}
							aria-label={t("language")}
							className="min-w-40"
						>
							<Select.Trigger>
								<Select.Value />
								<Select.Indicator />
							</Select.Trigger>
							<Select.Popover>
								<ListBox>
									<ListBox.Item
										id="en"
										textValue={t("english")}
									>
										{t("english")}
									</ListBox.Item>
									<ListBox.Item
										id="zh-Hans"
										textValue={t("chineseSimplified")}
									>
										{t("chineseSimplified")}
									</ListBox.Item>
									<ListBox.Item
										id="zh-Hant"
										textValue={t("chineseTraditional")}
									>
										{t("chineseTraditional")}
									</ListBox.Item>
								</ListBox>
							</Select.Popover>
						</Select>
					</div>
				</Card.Content>
			</Card>

			<SidebarPanel />
		</div>
	);
}
