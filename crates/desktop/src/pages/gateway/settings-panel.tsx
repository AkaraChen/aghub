import {
	Alert,
	Input,
	NumberField,
	Spinner,
	Switch,
	toast,
} from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { GatewaySettingDto } from "../../generated/dto";
import { useApi } from "../../hooks/use-api";
import {
	gatewaySettingsQueryOptions,
	updateGatewaySettingMutationOptions,
} from "../../requests/gateway";
import {
	compareGatewaySettingGroups,
	gatewaySettingGroupLabelKey,
} from "./gateway-helpers";

interface SettingGroup {
	group: string;
	settings: GatewaySettingDto[];
}

function groupSettings(settings: GatewaySettingDto[]): SettingGroup[] {
	const buckets = new Map<string, GatewaySettingDto[]>();
	for (const setting of settings) {
		const bucket = buckets.get(setting.group);
		if (bucket) {
			bucket.push(setting);
		} else {
			buckets.set(setting.group, [setting]);
		}
	}
	return Array.from(buckets.entries())
		.map(([group, items]) => ({ group, settings: items }))
		.sort((a, b) => compareGatewaySettingGroups(a.group, b.group));
}

function TextSettingControl({
	setting,
	isPending,
	onCommit,
}: {
	setting: GatewaySettingDto;
	isPending: boolean;
	onCommit: (value: string) => void;
}) {
	const serverValue = typeof setting.value === "string" ? setting.value : "";
	const [value, setValue] = useState(serverValue);

	return (
		<Input
			value={value}
			onChange={(event) => setValue(event.target.value)}
			onBlur={() => {
				if (value !== serverValue) {
					onCommit(value);
				}
			}}
			disabled={setting.value === null || isPending}
			aria-label={setting.key}
			variant="secondary"
			className="w-64 text-sm"
		/>
	);
}

interface GatewaySettingsPanelProps {
	instanceId: string;
}

export function GatewaySettingsPanel({
	instanceId,
}: GatewaySettingsPanelProps) {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();

	const { data, isLoading } = useQuery(
		gatewaySettingsQueryOptions({ api, instanceId }),
	);

	const updateMutation = useMutation({
		...updateGatewaySettingMutationOptions({
			api,
			queryClient,
			onSuccess: () => {
				toast.success(t("gatewaySettingUpdated"));
			},
		}),
		onError: (error) => {
			console.error("Failed to update gateway setting:", error);
			toast.danger(
				error instanceof Error
					? error.message
					: t("gatewaySettingUpdateFailed"),
			);
		},
	});

	if (isLoading || !data) {
		return (
			<div className="flex h-32 items-center justify-center">
				<Spinner />
			</div>
		);
	}

	const groups = groupSettings(data.settings);
	const isKeyPending = (key: string) =>
		updateMutation.isPending && updateMutation.variables?.key === key;

	const renderControl = (setting: GatewaySettingDto) => {
		const isUnavailable = setting.value === null;

		if (setting.kind === "bool") {
			return (
				<Switch
					isSelected={setting.value === true}
					isDisabled={isUnavailable || isKeyPending(setting.key)}
					onChange={(checked) =>
						updateMutation.mutate({
							instanceId,
							key: setting.key,
							value: checked,
						})
					}
					aria-label={setting.key}
				>
					<Switch.Control>
						<Switch.Thumb />
					</Switch.Control>
				</Switch>
			);
		}

		if (setting.kind === "integer") {
			return (
				<NumberField
					value={
						typeof setting.value === "number" ? setting.value : 0
					}
					onChange={(value) => {
						if (Number.isNaN(value)) return;
						if (value === setting.value) return;
						updateMutation.mutate({
							instanceId,
							key: setting.key,
							value,
						});
					}}
					isDisabled={isUnavailable || isKeyPending(setting.key)}
					aria-label={setting.key}
					variant="secondary"
					className="w-36"
				>
					<NumberField.Group>
						<NumberField.DecrementButton />
						<NumberField.Input />
						<NumberField.IncrementButton />
					</NumberField.Group>
				</NumberField>
			);
		}

		return (
			<TextSettingControl
				// Remount when the server value changes so the local draft
				// resyncs after saves from elsewhere.
				key={`${setting.key}:${String(setting.value)}`}
				setting={setting}
				isPending={isKeyPending(setting.key)}
				onCommit={(value) =>
					updateMutation.mutate({
						instanceId,
						key: setting.key,
						value,
					})
				}
			/>
		);
	};

	return (
		<div className="flex flex-col gap-4">
			{data.warnings.length > 0 && (
				<Alert status="warning">
					<Alert.Indicator />
					<Alert.Content>
						<Alert.Title>
							{t("gatewaySettingsWarningsTitle")}
						</Alert.Title>
						<Alert.Description>
							{data.warnings.join("; ")}
						</Alert.Description>
					</Alert.Content>
				</Alert>
			)}

			{groups.map(({ group, settings }) => {
				const labelKey = gatewaySettingGroupLabelKey(group);
				return (
					<section key={group} className="flex flex-col gap-1">
						<h3 className="px-1 text-xs font-medium tracking-wider text-muted uppercase">
							{labelKey ? t(labelKey) : group}
						</h3>
						<div className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface">
							{settings.map((setting) => (
								<div
									key={setting.key}
									className="flex items-center justify-between gap-4 px-3 py-2.5"
								>
									<div className="min-w-0">
										<span className="block truncate font-mono text-sm text-foreground">
											{setting.key}
										</span>
										{setting.value === null && (
											<span className="text-xs text-muted">
												{t("gatewaySettingUnavailable")}
											</span>
										)}
									</div>
									<div className="shrink-0">
										{renderControl(setting)}
									</div>
								</div>
							))}
						</div>
					</section>
				);
			})}
		</div>
	);
}
