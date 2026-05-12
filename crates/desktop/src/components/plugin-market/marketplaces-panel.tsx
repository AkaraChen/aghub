"use client";

import {
	ArrowPathIcon,
	ExclamationCircleIcon,
	PlusIcon,
	TrashIcon,
} from "@heroicons/react/24/solid";
import { Button, Input, Label, Spinner, TextField, toast } from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type {
	CCMarketplaceEntryResponse,
	CCMarketplaceSourceResponse,
} from "../../generated/dto";
import { useApi } from "../../hooks/use-api";
import { cn } from "../../lib/utils";
import {
	addMarketplaceMutationOptions,
	marketplaceListQueryOptions,
	removeMarketplaceMutationOptions,
	updateMarketplaceOneMutationOptions,
} from "../../requests/plugins";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";

const PROTECTED_MARKETPLACES = new Set(["claude-plugins-official"]);

interface MarketplacesPanelProps {
	enabled: boolean;
	installScope: "global" | "project" | "local";
}

export function MarketplacesPanel({
	enabled,
	installScope,
}: MarketplacesPanelProps) {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const [source, setSource] = useState("");

	const errorMessage = (value: unknown) =>
		value instanceof Error ? value.message : t("unknownError");

	const { data, isLoading, isError, error, refetch } = useQuery(
		marketplaceListQueryOptions({ api, enabled }),
	);

	const addMutation = useMutation({
		...addMarketplaceMutationOptions({
			api,
			queryClient,
			onSuccess: (resp) => {
				setSource("");
				toast.success(
					t("marketplaceAdded", {
						name: resp.marketplace?.name ?? source,
					}),
				);
			},
		}),
		onError: (mutationError) => {
			toast.danger(t("marketplaceAddFailed"), {
				description: errorMessage(mutationError),
			});
		},
	});

	const removeMutation = useMutation({
		...removeMarketplaceMutationOptions({
			api,
			queryClient,
			onSuccess: (_data, name) => {
				toast.success(t("marketplaceRemoved", { name }));
			},
		}),
		onError: (mutationError, name) => {
			toast.danger(t("marketplaceRemoveFailed", { name }), {
				description: errorMessage(mutationError),
			});
		},
	});

	const updateOneMutation = useMutation({
		...updateMarketplaceOneMutationOptions({
			api,
			queryClient,
			onSuccess: (_data, name) => {
				toast.success(t("marketplaceUpdatedOne", { name }));
			},
		}),
		onError: (mutationError, name) => {
			toast.danger(t("marketplaceUpdateFailed"), {
				description: `${name}: ${errorMessage(mutationError)}`,
			});
		},
	});

	const handleAdd = () => {
		const trimmed = source.trim();
		if (!trimmed) {
			return;
		}
		addMutation.mutate({ source: trimmed, scope: installScope });
	};

	const marketplaces = data?.marketplaces ?? [];

	return (
		<div className="flex h-full min-h-0 flex-col gap-3">
			<div className="flex items-end gap-2">
				<TextField
					className="flex-1"
					variant="secondary"
					value={source}
					onChange={setSource}
					isDisabled={addMutation.isPending}
				>
					<Label>{t("marketplaceAddLabel")}</Label>
					<Input
						variant="secondary"
						placeholder={t("marketplaceAddPlaceholder")}
						onKeyDown={(event) => {
							if (event.key === "Enter") {
								event.preventDefault();
								handleAdd();
							}
						}}
					/>
				</TextField>
				<Button
					variant="primary"
					onPress={handleAdd}
					isDisabled={!source.trim() || addMutation.isPending}
				>
					{addMutation.isPending ? (
						<Spinner size="sm" />
					) : (
						<>
							<PlusIcon className="size-4" />
							{t("marketplaceAddSubmit")}
						</>
					)}
				</Button>
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto">
				{isLoading ? (
					<div className="flex h-full items-center justify-center">
						<Spinner size="md" />
					</div>
				) : isError ? (
					<Empty>
						<EmptyHeader>
							<EmptyMedia>
								<ExclamationCircleIcon className="size-8 text-danger" />
							</EmptyMedia>
							<EmptyTitle>
								{t("marketplaceLoadFailed")}
							</EmptyTitle>
						</EmptyHeader>
						<div className="mt-3 flex flex-col items-center gap-2">
							<p className="text-sm text-muted">
								{errorMessage(error)}
							</p>
							<Button
								variant="secondary"
								size="sm"
								onPress={() => refetch()}
							>
								{t("retry")}
							</Button>
						</div>
					</Empty>
				) : marketplaces.length === 0 ? (
					<Empty>
						<EmptyHeader>
							<EmptyTitle>{t("marketplaceNoneTitle")}</EmptyTitle>
						</EmptyHeader>
					</Empty>
				) : (
					<ul className="flex flex-col gap-2">
						{marketplaces.map((entry) => (
							<MarketplaceRow
								key={entry.name}
								entry={entry}
								onRemove={(name) => removeMutation.mutate(name)}
								onUpdate={(name) =>
									updateOneMutation.mutate(name)
								}
								removing={
									removeMutation.isPending &&
									removeMutation.variables === entry.name
								}
								updating={
									updateOneMutation.isPending &&
									updateOneMutation.variables === entry.name
								}
							/>
						))}
					</ul>
				)}
			</div>
		</div>
	);
}

interface MarketplaceRowProps {
	entry: CCMarketplaceEntryResponse;
	onRemove: (name: string) => void;
	onUpdate: (name: string) => void;
	removing: boolean;
	updating: boolean;
}

function MarketplaceRow({
	entry,
	onRemove,
	onUpdate,
	removing,
	updating,
}: MarketplaceRowProps) {
	const { t } = useTranslation();
	const isProtected = PROTECTED_MARKETPLACES.has(entry.name);
	return (
		<li className="rounded-lg border border-separator/60 bg-surface px-3 py-2.5">
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2">
						<span className="truncate text-sm font-medium">
							{entry.name}
						</span>
						{isProtected && (
							<span className="rounded bg-default/20 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted">
								{t("marketplaceProtected")}
							</span>
						)}
					</div>
					<p className="mt-0.5 truncate text-xs text-muted">
						{describeSource(entry.source)}
					</p>
					<p className="mt-0.5 truncate font-mono text-[11px] text-muted/80">
						{entry.install_location}
					</p>
				</div>
				<div className="flex shrink-0 items-center gap-1">
					<Button
						variant="secondary"
						size="sm"
						onPress={() => onUpdate(entry.name)}
						isDisabled={updating}
						aria-label={t("marketplaceRefresh")}
					>
						<ArrowPathIcon
							className={cn("size-4", updating && "animate-spin")}
						/>
					</Button>
					<Button
						variant="secondary"
						size="sm"
						onPress={() => onRemove(entry.name)}
						isDisabled={removing || isProtected}
						aria-label={t("marketplaceRemove")}
						className="text-danger"
					>
						{removing ? (
							<Spinner size="sm" />
						) : (
							<TrashIcon className="size-4" />
						)}
					</Button>
				</div>
			</div>
		</li>
	);
}

function describeSource(source: CCMarketplaceSourceResponse): string {
	switch (source.kind) {
		case "github":
			return `github:${source.repo}`;
		case "url":
			return source.url;
		case "local":
			return `local:${source.path}`;
	}
}
