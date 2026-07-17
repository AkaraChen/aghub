import { ServerStackIcon } from "@heroicons/react/24/solid";
import { Button, Card, Spinner } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useApi } from "../../hooks/use-api";
import { useGatewayLaunch } from "../../hooks/use-gateway-launch";
import { gatewayInstanceListQueryOptions } from "../../requests/gateway";
import { GatewayAccountsDrawer } from "./accounts-drawer";
import { CreateExternalGatewayDialog } from "./create-external-dialog";
import { gatewayLaunchLabel } from "./gateway-helpers";
import { GatewayInstanceRow } from "./instance-row";

/**
 * Gateway strip at the top of the inference-providers page: the
 * operational entry point for hosting/starting the local CLIProxyAPI
 * gateway and reaching its account pool. Configuration lives in
 * Settings → Gateway.
 */
export function GatewaySection() {
	const { t } = useTranslation();
	const api = useApi();
	const [isConnectOpen, setIsConnectOpen] = useState(false);
	const [drawerInstanceId, setDrawerInstanceId] = useState<string | null>(
		null,
	);
	const launch = useGatewayLaunch();

	const { data: instances = [], isLoading } = useQuery(
		gatewayInstanceListQueryOptions({ api }),
	);

	const drawerInstance =
		instances.find((item) => item.id === drawerInstanceId) ?? null;

	if (isLoading) {
		return null;
	}

	return (
		<section className="shrink-0 border-b border-border p-4 sm:px-6">
			{instances.length === 0 ? (
				<Card variant="secondary">
					<Card.Content className="flex flex-wrap items-center gap-4">
						<div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface-secondary text-foreground">
							<ServerStackIcon className="size-5" />
						</div>
						<div className="min-w-0 flex-1 basis-64">
							<Card.Title>{t("gatewayLocalGateway")}</Card.Title>
							<Card.Description className="mt-0.5">
								{t("gatewayValueProp")}
							</Card.Description>
						</div>
						<div className="flex shrink-0 items-center gap-2">
							<Button
								size="sm"
								isPending={launch.isPending}
								onPress={() => launch.launch({ start: true })}
							>
								{({ isPending }) => (
									<>
										{isPending && (
											<Spinner
												color="current"
												size="sm"
											/>
										)}
										{isPending
											? gatewayLaunchLabel(
													t,
													launch.stage,
													launch.progress,
												)
											: t("gatewayInstallAndStart")}
									</>
								)}
							</Button>
							<Button
								variant="secondary"
								size="sm"
								onPress={() => setIsConnectOpen(true)}
							>
								{t("gatewayAddExternal")}
							</Button>
						</div>
					</Card.Content>
				</Card>
			) : (
				<div className="flex flex-col gap-2">
					{instances.map((instance) => (
						<GatewayInstanceRow
							key={instance.id}
							instance={instance}
							onOpenAccounts={() =>
								setDrawerInstanceId(instance.id)
							}
						/>
					))}
					<p className="text-xs text-muted">
						{t("gatewayMirrorHint")}
					</p>
				</div>
			)}

			<CreateExternalGatewayDialog
				isOpen={isConnectOpen}
				onClose={() => setIsConnectOpen(false)}
			/>
			<GatewayAccountsDrawer
				instance={drawerInstance}
				instances={instances}
				onClose={() => setDrawerInstanceId(null)}
			/>
		</section>
	);
}
