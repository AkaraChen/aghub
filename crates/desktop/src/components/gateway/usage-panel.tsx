import { ChartBarIcon } from "@heroicons/react/24/solid";
import { Spinner, Table } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "../ui/empty";
import { useApi } from "../../hooks/use-api";
import { gatewayUsageQueryOptions } from "../../requests/gateway";
import { flattenGatewayUsage } from "./gateway-helpers";

interface GatewayUsagePanelProps {
	instanceId: string;
}

export function GatewayUsagePanel({ instanceId }: GatewayUsagePanelProps) {
	const { t } = useTranslation();
	const api = useApi();

	const { data, isLoading } = useQuery(
		gatewayUsageQueryOptions({ api, instanceId }),
	);

	if (isLoading) {
		return (
			<div className="flex h-32 items-center justify-center">
				<Spinner />
			</div>
		);
	}

	const rows = data ? flattenGatewayUsage(data) : [];

	if (rows.length === 0) {
		return (
			<Empty className="mt-2">
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<ChartBarIcon />
					</EmptyMedia>
					<EmptyTitle>{t("gatewayNoUsage")}</EmptyTitle>
					<EmptyDescription>
						{t("gatewayNoUsageDescription")}
					</EmptyDescription>
				</EmptyHeader>
			</Empty>
		);
	}

	const items = rows.map((row) => ({
		...row,
		id: `${row.provider}:${row.identifier}`,
	}));

	return (
		<Table>
			<Table.ScrollContainer>
				<Table.Content aria-label={t("gatewayTabUsage")}>
					<Table.Header>
						<Table.Column isRowHeader>
							{t("gatewayAccountProvider")}
						</Table.Column>
						<Table.Column>
							{t("gatewayUsageIdentifier")}
						</Table.Column>
						<Table.Column>{t("gatewayUsageSuccess")}</Table.Column>
						<Table.Column>{t("gatewayUsageFailed")}</Table.Column>
					</Table.Header>
					<Table.Body items={items}>
						{(row) => (
							<Table.Row id={row.id}>
								<Table.Cell>{row.provider}</Table.Cell>
								<Table.Cell>
									<span className="font-mono text-xs">
										{row.identifier}
									</span>
								</Table.Cell>
								<Table.Cell>
									<span className="text-success">
										{row.success}
									</span>
								</Table.Cell>
								<Table.Cell>
									<span className="text-danger">
										{row.failed}
									</span>
								</Table.Cell>
							</Table.Row>
						)}
					</Table.Body>
				</Table.Content>
			</Table.ScrollContainer>
		</Table>
	);
}
