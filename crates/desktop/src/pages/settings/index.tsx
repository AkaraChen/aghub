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
import { useQueryState } from "nuqs";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AgentCard } from "../../components/agent-card";
import { disableAgent, enableAgent } from "../../lib/store";
import { useAgentAvailability } from "../../hooks/use-agent-availability";
import { useTheme } from "../../hooks/use-theme";
import IntegrationsPanel from "./integrations-panel";

export default function SettingsPage() {
	const { t, i18n } = useTranslation();
	const { theme, setTheme } = useTheme();
	const { availableAgents, refreshDisabledAgents } = useAgentAvailability();
	const [updating, setUpdating] = useState<string | null>(null);
	const [selectedTab, setSelectedTab] = useQueryState("tab", {
		defaultValue: "appearance",
	});

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
			await refreshDisabledAgents();
		} finally {
			setUpdating(null);
		}
	};

	return (
		<div className="h-full overflow-y-auto">
			<div className="max-w-3xl p-6">
				<Tabs
					selectedKey={selectedTab}
					onSelectionChange={(key) => {
						setSelectedTab(key as string);
					}}
				>
					<div className="mb-2 flex items-center justify-between">
						<h2 className="text-xl font-semibold">
							{t("settings")}
						</h2>

						<Tabs.ListContainer>
							<Tabs.List
								aria-label="Settings sections"
								className="inline-flex w-auto"
							>
								<Tabs.Tab id="appearance">
									{t("appearance")}
									<Tabs.Indicator />
								</Tabs.Tab>
								<Tabs.Tab id="agents">
									{t("agentManagement")}
									<Tabs.Indicator />
								</Tabs.Tab>
								<Tabs.Tab id="integrations">
									{t("integrations")}
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
						<div className="
        grid grid-cols-1 gap-3
        md:grid-cols-2
      ">
							{availableAgents
								.filter(
									(agent) => agent.availability.is_available,
								)
								.map((agent) => (
									<AgentCard
										key={agent.id}
										agent={agent}
										isUpdating={updating === agent.id}
										onToggle={handleToggleAgent}
									/>
								))}
						</div>
					</Tabs.Panel>

					<Tabs.Panel id="integrations">
						<IntegrationsPanel />
					</Tabs.Panel>
				</Tabs>
			</div>
		</div>
	);
}
