import { PlusIcon, TrashIcon } from "@heroicons/react/24/solid";
import { Button, Input, Spinner, Tag, TagGroup, toast } from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useApi } from "../../hooks/use-api";
import {
	gatewayOauthExcludedModelsQueryOptions,
	updateGatewayOauthExcludedModelsMutationOptions,
} from "../../requests/gateway";

interface ExcludedRule {
	id: string;
	provider: string;
	models: string[];
}

function createRule(provider = "", models: string[] = []): ExcludedRule {
	return { id: `excluded-rule-${crypto.randomUUID()}`, provider, models };
}

function ExcludedRuleRow({
	rule,
	onChange,
	onRemove,
}: {
	rule: ExcludedRule;
	onChange: (rule: ExcludedRule) => void;
	onRemove: () => void;
}) {
	const { t } = useTranslation();
	const [pendingModel, setPendingModel] = useState("");

	const commitPendingModel = () => {
		const name = pendingModel.trim();
		setPendingModel("");
		if (!name || rule.models.includes(name)) return;
		onChange({ ...rule, models: [...rule.models, name] });
	};

	return (
		<div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
			<div className="flex items-center gap-2">
				<Input
					value={rule.provider}
					onChange={(event) =>
						onChange({ ...rule, provider: event.target.value })
					}
					placeholder="gemini / claude / codex / kimi / xai"
					aria-label={t("gatewayAccountProvider")}
					variant="secondary"
					className="w-44 shrink-0 font-mono text-sm"
				/>
				<Input
					value={pendingModel}
					onChange={(event) => setPendingModel(event.target.value)}
					onBlur={commitPendingModel}
					onKeyDown={(event) => {
						if (event.key === "Enter") {
							event.preventDefault();
							commitPendingModel();
						}
					}}
					placeholder={t("gatewayExcludedModelPlaceholder")}
					aria-label={t("gatewayExcludedModelPlaceholder")}
					variant="secondary"
					className="min-w-0 flex-1 font-mono text-sm"
				/>
				<Button
					isIconOnly
					variant="ghost"
					size="sm"
					className="shrink-0 text-muted"
					aria-label={t("remove")}
					onPress={onRemove}
				>
					<TrashIcon className="size-4" />
				</Button>
			</div>
			{rule.models.length > 0 && (
				<TagGroup
					size="sm"
					aria-label={t("gatewayExcludedModelsTitle")}
					onRemove={(keys) =>
						onChange({
							...rule,
							models: rule.models.filter(
								(model) => !keys.has(model),
							),
						})
					}
				>
					<TagGroup.List
						items={rule.models.map((model) => ({ id: model }))}
					>
						{(item) => (
							<Tag id={item.id} textValue={item.id}>
								{item.id}
								<Tag.RemoveButton />
							</Tag>
						)}
					</TagGroup.List>
				</TagGroup>
			)}
		</div>
	);
}

interface GatewayExcludedModelsPanelProps {
	instanceId: string;
}

export function GatewayExcludedModelsPanel({
	instanceId,
}: GatewayExcludedModelsPanelProps) {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const [draft, setDraft] = useState<ExcludedRule[] | null>(null);

	const { data, isLoading } = useQuery(
		gatewayOauthExcludedModelsQueryOptions({ api, instanceId }),
	);

	const serverRules = useMemo(
		() =>
			data
				? Object.entries(data.providers).map(([provider, models]) =>
						createRule(provider, models),
					)
				: null,
		[data],
	);
	const rules = draft ?? serverRules ?? [];
	const isDirty = draft !== null;

	const saveMutation = useMutation({
		...updateGatewayOauthExcludedModelsMutationOptions({
			api,
			queryClient,
			onSuccess: () => {
				toast.success(t("gatewayExcludedModelsSaved"));
				setDraft(null);
			},
		}),
		onError: (error) => {
			console.error("Failed to save excluded models:", error);
			toast.danger(
				error instanceof Error
					? error.message
					: t("gatewayExcludedModelsSaveFailed"),
			);
		},
	});

	const handleSave = () => {
		const providers: Record<string, string[]> = {};
		for (const rule of rules) {
			const provider = rule.provider.trim();
			if (!provider || rule.models.length === 0) continue;
			providers[provider] = rule.models;
		}
		saveMutation.mutate({ instanceId, body: { providers } });
	};

	if (isLoading) {
		return (
			<div className="flex h-24 items-center justify-center">
				<Spinner />
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-3">
			<div className="flex items-center justify-between gap-3">
				<span className="text-xs text-muted">
					{t("gatewayExcludedModelsHint")}
				</span>
				<div className="flex shrink-0 items-center gap-2">
					<Button
						variant="secondary"
						size="sm"
						onPress={() => setDraft([...rules, createRule()])}
					>
						<PlusIcon className="size-4" />
						{t("gatewayExcludedModelsAddRule")}
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

			{rules.length === 0 ? (
				<p className="py-2 text-sm text-muted">
					{t("gatewayExcludedModelsEmpty")}
				</p>
			) : (
				<div className="flex flex-col gap-2">
					{rules.map((rule) => (
						<ExcludedRuleRow
							key={rule.id}
							rule={rule}
							onChange={(next) =>
								setDraft(
									rules.map((candidate) =>
										candidate.id === next.id
											? next
											: candidate,
									),
								)
							}
							onRemove={() =>
								setDraft(
									rules.filter(
										(candidate) => candidate.id !== rule.id,
									),
								)
							}
						/>
					))}
				</div>
			)}
		</div>
	);
}
