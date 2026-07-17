import { Button, Spinner, TextArea, toast } from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useApi } from "../../hooks/use-api";
import {
	gatewayConfigFileQueryOptions,
	updateGatewayConfigFileMutationOptions,
} from "../../requests/gateway";

interface GatewayConfigPanelProps {
	instanceId: string;
}

export function GatewayConfigPanel({ instanceId }: GatewayConfigPanelProps) {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const [draft, setDraft] = useState<string | null>(null);

	const { data, isLoading } = useQuery(
		gatewayConfigFileQueryOptions({ api, instanceId }),
	);

	const content = draft ?? data?.content ?? "";
	const isDirty = draft !== null && draft !== (data?.content ?? "");

	const saveMutation = useMutation({
		...updateGatewayConfigFileMutationOptions({
			api,
			queryClient,
			onSuccess: () => {
				toast.success(t("gatewayConfigSaved"));
				setDraft(null);
			},
		}),
		onError: (error) => {
			console.error("Failed to save gateway config file:", error);
			toast.danger(
				error instanceof Error
					? error.message
					: t("gatewayConfigSaveFailed"),
			);
		},
	});

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
				<div className="min-w-0">
					<p className="text-sm text-muted">
						{t("gatewayConfigDescription")}
					</p>
					<p className="text-xs text-muted">
						{t("gatewayConfigHotReload")}
					</p>
				</div>
				<Button
					size="sm"
					className="shrink-0"
					isDisabled={!isDirty}
					isPending={saveMutation.isPending}
					onPress={() => saveMutation.mutate({ instanceId, content })}
				>
					{t("save")}
				</Button>
			</div>

			<TextArea
				value={content}
				onChange={(event) => setDraft(event.target.value)}
				aria-label={t("gatewayTabConfig")}
				variant="secondary"
				spellCheck={false}
				className="min-h-96 w-full font-mono text-xs leading-5"
			/>
		</div>
	);
}
