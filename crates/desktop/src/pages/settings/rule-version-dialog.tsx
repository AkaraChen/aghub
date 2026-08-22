import { ArrowUturnLeftIcon, ClockIcon } from "@heroicons/react/24/solid";
import { Button, Card, Modal, Spinner } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { RuleVersionResponse } from "../../generated/dto";
import { useApi } from "../../hooks/use-api";
import { ruleVersionsQueryOptions } from "../../requests/rules";

interface RuleVersionDialogProps {
	path: string;
	isOpen: boolean;
	onOpenChange: (isOpen: boolean) => void;
	onRestore: (version: RuleVersionResponse) => void;
}

export function RuleVersionDialog({
	path,
	isOpen,
	onOpenChange,
	onRestore,
}: RuleVersionDialogProps) {
	const { t, i18n } = useTranslation();
	const api = useApi();
	const { data: versions = [], isPending } = useQuery(
		ruleVersionsQueryOptions({ api, path }),
	);
	const latestVersion = versions[0];
	const dateTime = new Intl.DateTimeFormat(i18n.language, {
		dateStyle: "medium",
		timeStyle: "short",
	});

	return (
		<>
			<Card variant="secondary" className="shrink-0 p-0">
				<Card.Content
					role="region"
					aria-label={t("rulesVersionHistory")}
					className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between"
				>
					<div className="flex min-w-0 items-center gap-3">
						<div
							aria-hidden="true"
							className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-tertiary text-muted"
						>
							<ClockIcon className="size-4" />
						</div>
						<div className="min-w-0">
							<p className="text-sm font-medium text-foreground">
								{t("rulesVersionHistory")}
							</p>
							{isPending ? (
								<p className="text-xs text-muted">
									{t("loading")}
								</p>
							) : latestVersion ? (
								<p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted">
									<span>{t("rulesLatestVersion")}</span>
									<time
										dateTime={new Date(
											latestVersion.created_at,
										).toISOString()}
									>
										{dateTime.format(
											latestVersion.created_at,
										)}
									</time>
									<span aria-hidden="true">·</span>
									<span>
										{t("rulesVersionCount", {
											count: versions.length,
										})}
									</span>
								</p>
							) : (
								<p className="text-xs text-muted">
									{t("rulesNoSavedVersions")}
								</p>
							)}
						</div>
					</div>
					<Button
						size="sm"
						variant="secondary"
						className="shrink-0"
						onPress={() => onOpenChange(true)}
					>
						{t("rulesOpenVersionHistory")}
					</Button>
				</Card.Content>
			</Card>

			<Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
				<Modal.Container size="lg">
					<Modal.Dialog>
						<Modal.CloseTrigger />
						<Modal.Header>
							<Modal.Heading>
								{t("rulesVersionHistory")}
							</Modal.Heading>
						</Modal.Header>
						<Modal.Body className="min-h-48">
							{isPending ? (
								<div className="flex min-h-40 items-center justify-center">
									<Spinner />
								</div>
							) : versions.length === 0 ? (
								<p className="py-10 text-center text-sm text-muted">
									{t("rulesNoVersions")}
								</p>
							) : (
								<ul className="space-y-2">
									{versions.map((version) => (
										<li key={version.revision}>
											<Card
												variant="secondary"
												className="p-0"
											>
												<Card.Content className="p-3">
													<div className="mb-2 flex items-center justify-between gap-3">
														<time className="text-xs text-muted">
															{dateTime.format(
																version.created_at,
															)}
														</time>
														<Button
															size="sm"
															variant="ghost"
															onPress={() =>
																onRestore(
																	version,
																)
															}
														>
															<ArrowUturnLeftIcon className="size-4" />
															{t(
																"rulesRestoreVersion",
															)}
														</Button>
													</div>
													<pre className="max-h-36 overflow-auto font-mono text-xs leading-5 whitespace-pre-wrap text-foreground">
														{version.content}
													</pre>
												</Card.Content>
											</Card>
										</li>
									))}
								</ul>
							)}
						</Modal.Body>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</>
	);
}
