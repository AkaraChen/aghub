import { PlusIcon, TrashIcon } from "@heroicons/react/24/solid";
import { Button, Input, Spinner, toast } from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useApi } from "../../hooks/use-api";
import {
	gatewayApiKeysQueryOptions,
	updateGatewayApiKeysMutationOptions,
} from "../../requests/gateway";

interface GatewayKeyRow {
	id: string;
	value: string;
}

function createKeyRow(value = ""): GatewayKeyRow {
	return { id: `gateway-key-${crypto.randomUUID()}`, value };
}

interface GatewayApiKeysPanelProps {
	instanceId: string;
}

export function GatewayApiKeysPanel({ instanceId }: GatewayApiKeysPanelProps) {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const [draft, setDraft] = useState<GatewayKeyRow[] | null>(null);

	const { data, isLoading } = useQuery(
		gatewayApiKeysQueryOptions({ api, instanceId }),
	);

	// Derived rows keep stable ids per fetched payload so inputs don't
	// remount while typing.
	const serverRows = useMemo(
		() => (data ? data.keys.map((key) => createKeyRow(key)) : null),
		[data],
	);
	const rows = draft ?? serverRows ?? [];
	const isDirty = draft !== null;

	const saveMutation = useMutation({
		...updateGatewayApiKeysMutationOptions({
			api,
			queryClient,
			onSuccess: () => {
				toast.success(t("gatewayKeysSaved"));
				setDraft(null);
			},
		}),
		onError: (error) => {
			console.error("Failed to save gateway keys:", error);
			toast.danger(
				error instanceof Error
					? error.message
					: t("gatewayKeysSaveFailed"),
			);
		},
	});

	const handleChange = (id: string, value: string) => {
		setDraft(rows.map((row) => (row.id === id ? { ...row, value } : row)));
	};

	const handleRemove = (id: string) => {
		setDraft(rows.filter((row) => row.id !== id));
	};

	const handleAdd = () => {
		setDraft([...rows, createKeyRow()]);
	};

	const handleSave = () => {
		saveMutation.mutate({
			instanceId,
			keys: rows.map((row) => row.value.trim()).filter(Boolean),
		});
	};

	if (isLoading) {
		return (
			<div className="flex h-32 items-center justify-center">
				<Spinner />
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-3">
			<div className="flex items-center justify-between gap-3">
				<span className="text-sm text-muted">
					{t("gatewayKeysDescription")}
				</span>
				<div className="flex shrink-0 items-center gap-2">
					<Button variant="secondary" size="sm" onPress={handleAdd}>
						<PlusIcon className="size-4" />
						{t("gatewayAddKey")}
					</Button>
					<Button
						size="sm"
						isDisabled={!isDirty}
						isPending={saveMutation.isPending}
						onPress={handleSave}
					>
						{t("save")}
					</Button>
				</div>
			</div>

			{rows.length === 0 ? (
				<p className="py-4 text-center text-sm text-muted">
					{t("gatewayNoKeys")}
				</p>
			) : (
				<div className="grid gap-2">
					{rows.map((row, index) => (
						<div key={row.id} className="flex items-center gap-2">
							<span className="w-5 shrink-0 text-right font-mono text-xs text-muted">
								{index + 1}
							</span>
							<Input
								value={row.value}
								onChange={(event) =>
									handleChange(row.id, event.target.value)
								}
								placeholder={t("gatewayKeyPlaceholder")}
								aria-label={t("gatewayTabKeys")}
								variant="secondary"
								className="min-w-0 flex-1 font-mono text-sm"
							/>
							<Button
								isIconOnly
								variant="ghost"
								size="sm"
								className="shrink-0 text-muted"
								aria-label={t("remove")}
								onPress={() => handleRemove(row.id)}
							>
								<TrashIcon className="size-4" />
							</Button>
						</div>
					))}
				</div>
			)}
		</div>
	);
}
