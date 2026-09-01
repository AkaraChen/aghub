import { Tabs } from "@heroui/react";
import { useQueryState } from "nuqs";
import { useLayoutEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import AgentsPanel from "./agents-panel";
import AppearancePanel from "./appearance-panel";
import ApplicationPanel from "./application-panel";
import IntegrationsPanel from "./integrations-panel";
import LogsPanel from "./logs-panel";
import PromptDataPanel from "./prompt-data-panel";
import RuleVersionDataPanel from "./rule-version-data-panel";
import SecurityPanel from "./security-panel";
import SkillPreferencesPanel from "./skill-preferences-panel";
import UsagePanel from "./usage-panel";
import "./settings-tabs.css";

const settingsTabClassName = "whitespace-nowrap";

function useSettingsTabRows() {
	const tabListRef = useRef<HTMLDivElement>(null);

	useLayoutEffect(() => {
		const tabList = tabListRef.current;
		if (!tabList) return;

		const updateRows = () => {
			const tabs = Array.from(
				tabList.querySelectorAll<HTMLElement>(":scope > [role=tab]"),
			);
			const listStyle = getComputedStyle(tabList);
			const inlinePaddingStart = Number.parseFloat(
				listStyle.paddingInlineStart,
			);
			const inlinePaddingEnd = Number.parseFloat(
				listStyle.paddingInlineEnd,
			);
			const rowTops = [...new Set(tabs.map((tab) => tab.offsetTop))].sort(
				(a, b) => a - b,
			);

			tabList.dataset.rowCount = String(rowTops.length);
			rowTops.slice(0, 2).forEach((top, index) => {
				const row = tabs.filter((tab) => tab.offsetTop === top);
				const firstTab = row[0];
				const lastTab = row.at(-1);
				if (!firstTab || !lastTab) return;

				const firstStyle = getComputedStyle(firstTab);
				const lastStyle = getComputedStyle(lastTab);
				const blockStart =
					firstTab.offsetTop -
					Number.parseFloat(firstStyle.marginBlockStart);
				const blockEnd =
					lastTab.offsetTop +
					lastTab.offsetHeight +
					Number.parseFloat(lastStyle.marginBlockEnd);
				const inlineStart = Math.max(
					0,
					firstTab.offsetLeft -
						tabList.clientLeft -
						inlinePaddingStart,
				);
				const inlineEnd = Math.max(
					0,
					tabList.clientWidth -
						(lastTab.offsetLeft + lastTab.offsetWidth) -
						inlinePaddingEnd,
				);
				const rowNumber = index + 1;

				tabList.style.setProperty(
					`--settings-tabs-row-${rowNumber}-top`,
					`${blockStart}px`,
				);
				tabList.style.setProperty(
					`--settings-tabs-row-${rowNumber}-height`,
					`${blockEnd - blockStart}px`,
				);
				tabList.style.setProperty(
					`--settings-tabs-row-${rowNumber}-left`,
					`${inlineStart}px`,
				);
				tabList.style.setProperty(
					`--settings-tabs-row-${rowNumber}-right`,
					`${inlineEnd}px`,
				);
			});
		};

		const observer = new ResizeObserver(updateRows);
		observer.observe(tabList);
		for (const tab of tabList.querySelectorAll(":scope > [role=tab]")) {
			observer.observe(tab);
		}
		updateRows();

		return () => observer.disconnect();
	}, []);

	return tabListRef;
}

export default function SettingsPage() {
	const { t } = useTranslation();
	const tabListRef = useSettingsTabRows();
	const [selectedTab, setSelectedTab] = useQueryState("tab", {
		defaultValue: "appearance",
	});
	const activeTab = selectedTab === "security" ? "skills" : selectedTab;

	return (
		<div className="h-full overflow-y-auto">
			<div
				data-testid="settings-content"
				className="mx-auto w-full max-w-5xl p-4 sm:p-6"
			>
				<Tabs
					className="min-w-0"
					selectedKey={activeTab}
					onSelectionChange={(key) => {
						setSelectedTab(key as string);
					}}
				>
					<div className="mb-2 flex min-w-0 flex-col items-start gap-3 lg:flex-row lg:items-center lg:justify-between">
						<h2 className="text-xl font-semibold">
							{t("settings")}
						</h2>

						<Tabs.List
							ref={tabListRef}
							data-settings-tabs-list=""
							data-testid="settings-tabs-list"
							aria-label="Settings sections"
						>
							<Tabs.Tab
								id="appearance"
								className={settingsTabClassName}
							>
								{t("appearance")}
								<Tabs.Indicator />
							</Tabs.Tab>
							<Tabs.Tab
								id="agents"
								className={settingsTabClassName}
							>
								{t("agentManagement")}
								<Tabs.Indicator />
							</Tabs.Tab>
							<Tabs.Tab
								id="integrations"
								className={settingsTabClassName}
							>
								{t("integrations")}
								<Tabs.Indicator />
							</Tabs.Tab>
							<Tabs.Tab
								id="skills"
								className={settingsTabClassName}
							>
								{t("skills")}
								<Tabs.Indicator />
							</Tabs.Tab>
							<Tabs.Tab
								id="prompts"
								className={settingsTabClassName}
							>
								{t("prompts")}
								<Tabs.Indicator />
							</Tabs.Tab>
							<Tabs.Tab
								id="rules"
								className={settingsTabClassName}
							>
								{t("rules")}
								<Tabs.Indicator />
							</Tabs.Tab>
							<Tabs.Tab
								id="logs"
								className={settingsTabClassName}
							>
								{t("logs")}
								<Tabs.Indicator />
							</Tabs.Tab>
							<Tabs.Tab
								id="usage"
								className={settingsTabClassName}
							>
								{t("usage")}
								<Tabs.Indicator />
							</Tabs.Tab>
							<Tabs.Tab
								id="application"
								className={settingsTabClassName}
							>
								{t("application")}
								<Tabs.Indicator />
							</Tabs.Tab>
						</Tabs.List>
					</div>

					<Tabs.Panel id="appearance">
						<AppearancePanel />
					</Tabs.Panel>

					<Tabs.Panel id="agents">
						<AgentsPanel />
					</Tabs.Panel>

					<Tabs.Panel id="integrations">
						<IntegrationsPanel />
					</Tabs.Panel>

					<Tabs.Panel id="skills">
						<div className="space-y-6">
							<section
								aria-labelledby="skill-management-heading"
								className="space-y-3"
							>
								<h3
									id="skill-management-heading"
									className="px-1 text-sm font-medium text-foreground"
								>
									{t("skillManagement")}
								</h3>
								<SkillPreferencesPanel />
							</section>
							<section
								aria-labelledby="skill-security-heading"
								className="space-y-3 border-t border-separator pt-6"
							>
								<h3
									id="skill-security-heading"
									className="px-1 text-sm font-medium text-foreground"
								>
									{t("skillSecurity")}
								</h3>
								<div className="grid min-w-0 xl:grid-cols-2">
									<SecurityPanel />
								</div>
							</section>
						</div>
					</Tabs.Panel>

					<Tabs.Panel id="prompts">
						<PromptDataPanel />
					</Tabs.Panel>

					<Tabs.Panel id="rules">
						<RuleVersionDataPanel />
					</Tabs.Panel>

					<Tabs.Panel id="logs">
						<LogsPanel />
					</Tabs.Panel>

					<Tabs.Panel id="usage">
						<UsagePanel />
					</Tabs.Panel>

					<Tabs.Panel id="application">
						<ApplicationPanel />
					</Tabs.Panel>
				</Tabs>
			</div>
		</div>
	);
}
