import { ArrowLeftIcon, PowerIcon } from "@heroicons/react/24/solid";
import { Button, Chip, Spinner, Tabs } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { useQueryState } from "nuqs";
import { useTranslation } from "react-i18next";
import { useLocation, useParams } from "wouter";
import { Redirect } from "../../components/redirect";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "../../components/ui/empty";
import { useApi } from "../../hooks/use-api";
import { cn } from "../../lib/utils";
import {
	gatewayInstanceListQueryOptions,
	gatewayVersionQueryOptions,
} from "../../requests/gateway";
import { GatewayAccountsPanel } from "./accounts-panel";
import { GatewayApiKeysPanel } from "./api-keys-panel";
import { GatewayConfigPanel } from "./config-panel";
import { GATEWAY_STATUS_DISPLAY } from "./gateway-helpers";
import { GatewaySettingsPanel } from "./settings-panel";
import { GatewayUsagePanel } from "./usage-panel";

function InstanceNotRunningNotice() {
	const { t } = useTranslation();
	return (
		<Empty className="mt-2">
			<EmptyHeader>
				<EmptyMedia variant="icon">
					<PowerIcon />
				</EmptyMedia>
				<EmptyTitle>{t("gatewayInstanceNotRunning")}</EmptyTitle>
				<EmptyDescription>
					{t("gatewayInstanceNotRunningDescription")}
				</EmptyDescription>
			</EmptyHeader>
		</Empty>
	);
}

export default function GatewayInstanceDetailPage() {
	const { t } = useTranslation();
	const { id } = useParams();
	const api = useApi();
	const [, setLocation] = useLocation();
	const [selectedTab, setSelectedTab] = useQueryState("tab", {
		defaultValue: "accounts",
	});

	const instanceId = id ?? "";
	const { data: instances = [], isLoading } = useQuery(
		gatewayInstanceListQueryOptions({ api }),
	);
	const instance = instances.find((item) => item.id === instanceId);

	const { data: version } = useQuery(
		gatewayVersionQueryOptions({
			api,
			instanceId,
			enabled: Boolean(instance),
		}),
	);

	if (isLoading) {
		return (
			<div className="flex h-full items-center justify-center">
				<Spinner />
			</div>
		);
	}

	if (!instance) {
		return <Redirect to="/gateway" />;
	}

	const statusDisplay = GATEWAY_STATUS_DISPLAY[instance.status];
	const isRunning = instance.status === "running";

	return (
		<div className="h-full overflow-y-auto">
			<div className="w-full p-4 sm:p-6">
				<div className="mb-4 flex items-start gap-3">
					<Button
						isIconOnly
						variant="ghost"
						size="sm"
						className="mt-0.5 shrink-0 text-muted"
						aria-label={t("gatewayBackToList")}
						onPress={() => setLocation("/gateway")}
					>
						<ArrowLeftIcon className="size-4" />
					</Button>
					<div className="min-w-0 flex-1">
						<div className="flex min-w-0 flex-wrap items-center gap-2">
							<h2 className="truncate text-xl font-semibold">
								{instance.name}
							</h2>
							<Chip size="sm" variant="soft">
								{instance.kind === "managed"
									? t("gatewayKindManaged")
									: t("gatewayKindExternal")}
							</Chip>
							<span className="flex shrink-0 items-center gap-1.5 text-xs text-muted">
								<span
									className={cn(
										"size-2 rounded-full",
										statusDisplay.dotClass,
									)}
									aria-hidden
								/>
								{t(statusDisplay.labelKey)}
							</span>
						</div>
						<div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
							<span className="truncate font-mono">
								{instance.base_url}
							</span>
							{version && (
								<>
									<span>
										{t("gatewayVersionInstalled")}:{" "}
										{version.installed ?? "—"}
									</span>
									<span>
										{t("gatewayVersionPinned")}:{" "}
										{version.pinned}
									</span>
									{version.latest && (
										<span>
											{t("gatewayVersionLatest")}:{" "}
											{version.latest}
										</span>
									)}
								</>
							)}
						</div>
					</div>
					<Button
						variant="secondary"
						size="sm"
						className="shrink-0"
						onPress={() => setLocation("/inference-providers")}
					>
						{t("gatewayUseInInference")}
					</Button>
				</div>

				<Tabs
					selectedKey={selectedTab}
					onSelectionChange={(key) => {
						setSelectedTab(key as string);
					}}
				>
					<Tabs.ListContainer>
						<Tabs.List
							aria-label={t("gateway")}
							className="inline-flex w-auto"
						>
							<Tabs.Tab id="accounts">
								{t("gatewayTabAccounts")}
								<Tabs.Indicator />
							</Tabs.Tab>
							<Tabs.Tab id="keys">
								{t("gatewayTabKeys")}
								<Tabs.Indicator />
							</Tabs.Tab>
							<Tabs.Tab id="settings">
								{t("settings")}
								<Tabs.Indicator />
							</Tabs.Tab>
							<Tabs.Tab id="config">
								{t("gatewayTabConfig")}
								<Tabs.Indicator />
							</Tabs.Tab>
							<Tabs.Tab id="usage">
								{t("gatewayTabUsage")}
								<Tabs.Indicator />
							</Tabs.Tab>
						</Tabs.List>
					</Tabs.ListContainer>

					<Tabs.Panel id="accounts">
						{isRunning ? (
							<GatewayAccountsPanel
								instance={instance}
								instances={instances}
							/>
						) : (
							<InstanceNotRunningNotice />
						)}
					</Tabs.Panel>
					<Tabs.Panel id="keys">
						{isRunning ? (
							<GatewayApiKeysPanel instanceId={instance.id} />
						) : (
							<InstanceNotRunningNotice />
						)}
					</Tabs.Panel>
					<Tabs.Panel id="settings">
						{isRunning ? (
							<GatewaySettingsPanel instanceId={instance.id} />
						) : (
							<InstanceNotRunningNotice />
						)}
					</Tabs.Panel>
					<Tabs.Panel id="config">
						{isRunning ? (
							<GatewayConfigPanel instanceId={instance.id} />
						) : (
							<InstanceNotRunningNotice />
						)}
					</Tabs.Panel>
					<Tabs.Panel id="usage">
						{isRunning ? (
							<GatewayUsagePanel instanceId={instance.id} />
						) : (
							<InstanceNotRunningNotice />
						)}
					</Tabs.Panel>
				</Tabs>
			</div>
		</div>
	);
}
