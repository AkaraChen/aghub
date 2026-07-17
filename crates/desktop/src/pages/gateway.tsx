import {
	GlobeAltIcon,
	PlusIcon,
	ServerStackIcon,
} from "@heroicons/react/24/solid";
import { Button, Card, Spinner } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useApi } from "../hooks/use-api";
import { gatewayInstanceListQueryOptions } from "../requests/gateway";
import {
	CreateExternalGatewayDialog,
	CreateManagedGatewayDialog,
} from "./gateway/create-instance-dialogs";
import { GatewayInstanceCard } from "./gateway/instance-card";

function EntryCard({
	icon,
	title,
	description,
	actionLabel,
	onPress,
}: {
	icon: React.ReactNode;
	title: string;
	description: string;
	actionLabel: string;
	onPress: () => void;
}) {
	return (
		<Card variant="secondary">
			<Card.Content className="flex h-full flex-col items-start gap-3">
				<div className="flex size-10 items-center justify-center rounded-lg bg-surface-secondary text-foreground">
					{icon}
				</div>
				<div className="flex-1">
					<Card.Title>{title}</Card.Title>
					<Card.Description className="mt-1">
						{description}
					</Card.Description>
				</div>
				<Button variant="secondary" size="sm" onPress={onPress}>
					<PlusIcon className="size-4" />
					{actionLabel}
				</Button>
			</Card.Content>
		</Card>
	);
}

export default function GatewayPage() {
	const { t } = useTranslation();
	const api = useApi();
	const [isManagedOpen, setIsManagedOpen] = useState(false);
	const [isExternalOpen, setIsExternalOpen] = useState(false);

	const { data: instances = [], isLoading } = useQuery(
		gatewayInstanceListQueryOptions({ api }),
	);

	const hasManaged = instances.some(
		(instance) => instance.kind === "managed",
	);

	return (
		<div className="h-full overflow-y-auto">
			<div className="w-full p-4 sm:p-6">
				<div className="mb-4 flex items-start justify-between gap-3">
					<div>
						<h2 className="text-xl font-semibold">
							{t("gateway")}
						</h2>
						<p className="mt-1 text-sm text-muted">
							{t("gatewayPageDescription")}
						</p>
					</div>
					{instances.length > 0 && (
						<div className="flex shrink-0 items-center gap-2">
							<Button
								variant="secondary"
								size="sm"
								isDisabled={hasManaged}
								onPress={() => setIsManagedOpen(true)}
							>
								<PlusIcon className="size-4" />
								{t("gatewayAddManaged")}
							</Button>
							<Button
								variant="secondary"
								size="sm"
								onPress={() => setIsExternalOpen(true)}
							>
								<PlusIcon className="size-4" />
								{t("gatewayAddExternal")}
							</Button>
						</div>
					)}
				</div>

				{isLoading ? (
					<div className="flex h-48 items-center justify-center">
						<Spinner />
					</div>
				) : instances.length === 0 ? (
					<div className="grid gap-3 sm:grid-cols-2">
						<EntryCard
							icon={<ServerStackIcon className="size-5" />}
							title={t("gatewayAddManaged")}
							description={t("gatewayEmptyManagedDescription")}
							actionLabel={t("gatewayAddManaged")}
							onPress={() => setIsManagedOpen(true)}
						/>
						<EntryCard
							icon={<GlobeAltIcon className="size-5" />}
							title={t("gatewayAddExternal")}
							description={t("gatewayEmptyExternalDescription")}
							actionLabel={t("gatewayAddExternal")}
							onPress={() => setIsExternalOpen(true)}
						/>
					</div>
				) : (
					<div className="grid gap-3">
						{instances.map((instance) => (
							<GatewayInstanceCard
								key={instance.id}
								instance={instance}
							/>
						))}
					</div>
				)}
			</div>

			<CreateManagedGatewayDialog
				isOpen={isManagedOpen}
				onClose={() => setIsManagedOpen(false)}
			/>
			<CreateExternalGatewayDialog
				isOpen={isExternalOpen}
				onClose={() => setIsExternalOpen(false)}
			/>
		</div>
	);
}
