import { ArrowPathIcon, DocumentTextIcon } from "@heroicons/react/24/solid";
import { AlertDialog, Button, Spinner, toast } from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "../ui/empty";
import { useApi } from "../../hooks/use-api";
import { cn } from "../../lib/utils";
import {
	clearGatewayLogsMutationOptions,
	gatewayLogsQueryOptions,
	updateGatewaySettingMutationOptions,
} from "../../requests/gateway";

const LOGGING_DISABLED_MARKER = "logging to file disabled";

interface GatewayLogsPanelProps {
	instanceId: string;
}

export function GatewayLogsPanel({ instanceId }: GatewayLogsPanelProps) {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const [isClearOpen, setIsClearOpen] = useState(false);
	const scrollRef = useRef<HTMLDivElement>(null);
	const errorToastedRef = useRef(false);

	const logsQuery = useQuery(gatewayLogsQueryOptions({ api, instanceId }));

	const isLoggingDisabled =
		logsQuery.error instanceof Error &&
		logsQuery.error.message.toLowerCase().includes(LOGGING_DISABLED_MARKER);

	// Follow the tail: pin the viewport to the newest lines on every fetch.
	useEffect(() => {
		const el = scrollRef.current;
		if (el) {
			el.scrollTop = el.scrollHeight;
		}
	}, [logsQuery.data]);

	// Surface unexpected fetch errors once (the disabled state renders its
	// own onboarding instead).
	useEffect(() => {
		if (!logsQuery.error || isLoggingDisabled) {
			errorToastedRef.current = false;
			return;
		}
		if (errorToastedRef.current) return;
		errorToastedRef.current = true;
		toast.danger(logsQuery.error.message || t("gatewayLogsLoadFailed"));
	}, [logsQuery.error, isLoggingDisabled, t]);

	const enableLoggingMutation = useMutation({
		...updateGatewaySettingMutationOptions({
			api,
			queryClient,
			onSuccess: () => {
				toast.success(t("gatewaySettingUpdated"));
				void logsQuery.refetch();
			},
		}),
		onError: (error) => {
			console.error("Failed to enable file logging:", error);
			toast.danger(
				error instanceof Error
					? error.message
					: t("gatewaySettingUpdateFailed"),
			);
		},
	});

	const clearMutation = useMutation({
		...clearGatewayLogsMutationOptions({
			api,
			queryClient,
			onSuccess: () => {
				toast.success(t("gatewayLogsCleared"));
				setIsClearOpen(false);
			},
		}),
		onError: (error) => {
			console.error("Failed to clear gateway logs:", error);
			toast.danger(
				error instanceof Error
					? error.message
					: t("gatewayLogsClearFailed"),
			);
		},
	});

	if (logsQuery.isLoading) {
		return (
			<div className="flex h-32 items-center justify-center">
				<Spinner />
			</div>
		);
	}

	if (isLoggingDisabled) {
		return (
			<Empty className="mt-2">
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<DocumentTextIcon />
					</EmptyMedia>
					<EmptyTitle>{t("gatewayLogsDisabled")}</EmptyTitle>
					<EmptyDescription>
						{t("gatewayLogsDisabledDescription")}
					</EmptyDescription>
				</EmptyHeader>
				<Button
					variant="secondary"
					size="sm"
					isPending={enableLoggingMutation.isPending}
					onPress={() =>
						enableLoggingMutation.mutate({
							instanceId,
							key: "logging-to-file",
							value: true,
						})
					}
				>
					{t("gatewayLogsEnable")}
				</Button>
			</Empty>
		);
	}

	const lines = logsQuery.data?.lines ?? [];

	return (
		<div className="flex flex-col gap-3">
			<div className="flex items-center justify-between gap-3">
				<span className="text-xs text-muted tabular-nums">
					{t("gatewayLogsLineCount", {
						count: logsQuery.data?.line_count ?? 0,
					})}
				</span>
				<div className="flex shrink-0 items-center gap-1.5">
					<Button
						isIconOnly
						variant="ghost"
						size="sm"
						className="text-muted"
						aria-label={t("refresh")}
						onPress={() => void logsQuery.refetch()}
					>
						<ArrowPathIcon
							className={cn(
								"size-4",
								logsQuery.isFetching && "animate-spin",
							)}
						/>
					</Button>
					<Button
						variant="secondary"
						size="sm"
						isDisabled={lines.length === 0}
						onPress={() => setIsClearOpen(true)}
					>
						{t("gatewayLogsClear")}
					</Button>
				</div>
			</div>

			{lines.length === 0 ? (
				<p className="py-4 text-center text-sm text-muted">
					{t("gatewayLogsEmpty")}
				</p>
			) : (
				<div
					ref={scrollRef}
					className="max-h-96 overflow-y-auto rounded-lg border border-border bg-surface-secondary p-3"
				>
					<pre className="font-mono text-xs leading-5 whitespace-pre-wrap text-foreground">
						{lines.join("\n")}
					</pre>
				</div>
			)}

			<AlertDialog.Backdrop
				isOpen={isClearOpen}
				onOpenChange={setIsClearOpen}
			>
				<AlertDialog.Container>
					<AlertDialog.Dialog className="sm:max-w-[420px]">
						<AlertDialog.CloseTrigger />
						<AlertDialog.Header>
							<AlertDialog.Icon status="danger" />
							<AlertDialog.Heading>
								{t("gatewayLogsClear")}
							</AlertDialog.Heading>
						</AlertDialog.Header>
						<AlertDialog.Body>
							{t("gatewayLogsClearConfirm")}
						</AlertDialog.Body>
						<AlertDialog.Footer>
							<Button
								variant="tertiary"
								isDisabled={clearMutation.isPending}
								onPress={() => setIsClearOpen(false)}
							>
								{t("cancel")}
							</Button>
							<Button
								variant="danger"
								isPending={clearMutation.isPending}
								onPress={() => clearMutation.mutate(instanceId)}
							>
								{t("gatewayLogsClear")}
							</Button>
						</AlertDialog.Footer>
					</AlertDialog.Dialog>
				</AlertDialog.Container>
			</AlertDialog.Backdrop>
		</div>
	);
}
