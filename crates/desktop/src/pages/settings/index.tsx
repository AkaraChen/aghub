import {
	ComputerDesktopIcon,
	MoonIcon,
	SunIcon,
} from "@heroicons/react/24/solid";
import {
	ListBox,
	Select,
	Tabs,
	ToggleButton,
	ToggleButtonGroup,
} from "@heroui/react";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../providers/theme";
import { useAgentAvailability } from "../../providers/agent-availability";
import { disableAgent, enableAgent } from "../../lib/store";
import { CheckCircleIcon, XCircleIcon } from "@heroicons/react/24/solid";
import { Chip, Switch } from "@heroui/react";
import { useState } from "react";

export default function SettingsPage() {
	const { t, i18n } = useTranslation();
	const { theme, setTheme } = useTheme();
	const { availableAgents, refetch } = useAgentAvailability();
	const [updating, setUpdating] = useState<string | null>(null);
	const [selectedTab, setSelectedTab] = useState<string>("appearance");

	const changeLanguage = (lng: string) => {
		i18n.changeLanguage(lng);
		localStorage.setItem("language", lng);
	};

	const handleToggleAgent = async (
		agentId: string,
		currentlyDisabled: boolean,
	) => {
		setUpdating(agentId);
		try {
			if (currentlyDisabled) {
				await enableAgent(agentId);
			} else {
				await disableAgent(agentId);
			}
			refetch();
		} finally {
			setUpdating(null);
		}
	};

	return (
		<div className="h-full overflow-y-auto">
			<div className="p-6 max-w-3xl">
				<Tabs
					selectedKey={selectedTab}
					onSelectionChange={(key) => setSelectedTab(key as string)}
				>
					<div className="flex items-center justify-between mb-2">
						<h2 className="text-xl font-semibold">{t("settings")}</h2>

						<Tabs.ListContainer>
							<Tabs.List aria-label="Settings sections" className="w-auto inline-flex">
								<Tabs.Tab id="appearance">
									{t("appearance")}
									<Tabs.Indicator />
								</Tabs.Tab>
								<Tabs.Tab id="agents">
									{t("agentManagement")}
									<Tabs.Indicator />
								</Tabs.Tab>
							</Tabs.List>
						</Tabs.ListContainer>
					</div>

					<Tabs.Panel id="appearance">
						<div className="space-y-8">
							{/* Theme */}
							<div className="flex items-center justify-between">
								<span className="text-sm">{t("theme")}</span>
								<ToggleButtonGroup
									selectedKeys={[theme]}
									onSelectionChange={(keys) =>
										setTheme(
											[...keys][0] as
												| "light"
												| "dark"
												| "system",
										)
									}
									selectionMode="single"
									disallowEmptySelection
									size="sm"
								>
									<ToggleButton
										id="light"
										aria-label={t("light")}
									>
										<SunIcon className="size-4" />
										{t("light")}
									</ToggleButton>
									<ToggleButton
										id="dark"
										aria-label={t("dark")}
									>
										<ToggleButtonGroup.Separator />
										<MoonIcon className="size-4" />
										{t("dark")}
									</ToggleButton>
									<ToggleButton
										id="system"
										aria-label={t("system")}
									>
										<ToggleButtonGroup.Separator />
										<ComputerDesktopIcon className="size-4" />
										{t("system")}
									</ToggleButton>
								</ToggleButtonGroup>
							</div>

							{/* Language */}
							<div className="flex items-center justify-between">
								<span className="text-sm">{t("language")}</span>
								<Select
									value={
										i18n.language.startsWith("zh")
											? "zh"
											: "en"
									}
									onChange={(key) =>
										changeLanguage(key as string)
									}
									aria-label={t("language")}
									className="w-40"
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
												id="zh"
												textValue={t("chinese")}
											>
												{t("chinese")}
											</ListBox.Item>
										</ListBox>
									</Select.Popover>
								</Select>
							</div>
						</div>
					</Tabs.Panel>

					<Tabs.Panel id="agents">
						<div className="space-y-2">
							{availableAgents.map((agent) => {
								const isUpdating = updating === agent.id;
								const statusText = agent.availability
									.is_available
									? agent.isDisabled
										? t("disabledByUser")
										: t("available")
									: t("notAvailable");

								return (
									<div
										key={agent.id}
										className="flex items-center justify-between p-4 rounded-lg border border-border bg-surface"
									>
										<div className="flex items-center gap-4 flex-1 min-w-0">
											<div className="flex-1 min-w-0">
												<div className="flex items-center gap-2 mb-1">
													<span className="font-medium text-foreground">
														{agent.display_name}
													</span>
													<Chip
														size="sm"
														variant="soft"
													>
														{agent.id}
													</Chip>
												</div>
												<div className="flex items-center gap-3 text-xs text-muted">
													<span className="flex items-center gap-1">
														{agent.availability
															.has_global_directory ? (
															<CheckCircleIcon className="size-3.5 text-success" />
														) : (
															<XCircleIcon className="size-3.5 text-danger" />
														)}
														{t("globalConfig")}
													</span>
													<span className="flex items-center gap-1">
														{agent.availability
															.has_cli ? (
															<CheckCircleIcon className="size-3.5 text-success" />
														) : (
															<XCircleIcon className="size-3.5 text-danger" />
														)}
														{t("cli")}
													</span>
												</div>
											</div>
										</div>

										<div className="flex items-center gap-3">
											<Chip
												size="sm"
												variant="soft"
												color={
													agent.isUsable
														? "success"
														: agent.availability
																	.is_available &&
																agent.isDisabled
															? "warning"
															: "danger"
												}
											>
												{statusText}
											</Chip>

											<Switch
												isSelected={!agent.isDisabled}
												onChange={() =>
													handleToggleAgent(
														agent.id,
														agent.isDisabled,
													)
												}
												isDisabled={
													!agent.availability
														.is_available ||
													isUpdating
												}
												aria-label={t(
													"toggleAgent",
													{
														name: agent.display_name,
													},
												)}
											/>
										</div>
									</div>
								);
							})}
						</div>
					</Tabs.Panel>
				</Tabs>
			</div>
		</div>
	);
}
