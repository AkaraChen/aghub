import { ChevronDownIcon } from "@heroicons/react/24/solid";
import {
	Accordion,
	Button,
	Label,
	Radio,
	RadioGroup,
	toast,
} from "@heroui/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { CodexStandaloneSkillResponse } from "../generated/dto";
import { useApi } from "../hooks/use-api";
import { selectCodexVisibleCopyMutationOptions } from "../requests/skills";

const CODEX_VISIBLE_COPY_ID = "codex-visible-copy";

interface SkillCodexVisibleCopyProps {
	name: string;
	copies: CodexStandaloneSkillResponse[];
	projectRoot?: string;
}

export function SkillCodexVisibleCopy({
	name,
	copies,
	projectRoot,
}: SkillCodexVisibleCopyProps) {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const enabledCopies = copies.filter((copy) => copy.enabled);
	const [selectedPath, setSelectedPath] = useState(
		enabledCopies[0]?.source_path ?? copies[0]?.source_path ?? "",
	);
	const [isExpanded, setIsExpanded] = useState(enabledCopies.length > 1);
	const selectionIsCurrent =
		enabledCopies.length === 1 &&
		enabledCopies[0]?.source_path === selectedPath;
	const updateVisibility = useMutation(
		selectCodexVisibleCopyMutationOptions({
			api,
			queryClient,
			projectRoot,
			onSuccess: () => {
				toast.success(t("codexVisibleCopyUpdated"));
			},
		}),
	);

	if (copies.length <= 1) return null;

	return (
		<Accordion
			variant="surface"
			expandedKeys={
				isExpanded
					? new Set([CODEX_VISIBLE_COPY_ID])
					: new Set<string>()
			}
			onExpandedChange={(keys) =>
				setIsExpanded(keys.has(CODEX_VISIBLE_COPY_ID))
			}
		>
			<Accordion.Item id={CODEX_VISIBLE_COPY_ID}>
				<Accordion.Heading>
					<Accordion.Trigger>
						<div className="min-w-0 flex-1 text-left">
							<p>{t("codexVisibleCopies")}</p>
							<p className="truncate text-xs font-normal text-muted">
								{t("codexVisibleCopiesDescription", {
									count: enabledCopies.length,
									total: copies.length,
								})}
							</p>
						</div>
						<Accordion.Indicator>
							<ChevronDownIcon className="size-4" />
						</Accordion.Indicator>
					</Accordion.Trigger>
				</Accordion.Heading>
				<Accordion.Panel>
					<Accordion.Body>
						<div className="space-y-4">
							<RadioGroup
								aria-label={t("codexVisibleCopies")}
								value={selectedPath}
								onChange={setSelectedPath}
								className="grid gap-2"
								isDisabled={updateVisibility.isPending}
							>
								{copies.map((copy) => (
									<Radio
										key={copy.source_path}
										value={copy.source_path}
										className="rounded-xl border border-border bg-surface-secondary/60 p-3 transition-colors hover:bg-surface-secondary data-[selected=true]:border-accent/30 data-[selected=true]:bg-accent/5"
									>
										<Radio.Content className="min-w-0 gap-3">
											<Radio.Control className="shrink-0">
												<Radio.Indicator />
											</Radio.Control>
											<div className="min-w-0 flex-1">
												<Label className="block truncate font-mono text-xs text-foreground">
													{copy.source_path}
												</Label>
												<p className="mt-1 text-xs text-muted">
													{t(
														copy.enabled
															? "visibleInCodex"
															: "hiddenInCodex",
													)}
												</p>
											</div>
										</Radio.Content>
									</Radio>
								))}
							</RadioGroup>
							<div className="flex flex-wrap items-center justify-between gap-3 border-t border-separator pt-4">
								<p className="text-xs text-muted">
									{t("codexVisibleCopyFileNotice")}
								</p>
								<Button
									variant="primary"
									isPending={updateVisibility.isPending}
									isDisabled={
										!selectedPath || selectionIsCurrent
									}
									onPress={() =>
										updateVisibility.mutate(
											{
												name,
												source_path: selectedPath,
											},
											{
												onError: (error) =>
													toast.danger(
														t(
															"codexVisibleCopyUpdateFailed",
															{
																error:
																	error instanceof
																	Error
																		? error.message
																		: String(
																				error,
																			),
															},
														),
													),
											},
										)
									}
								>
									{t("showOnlySelectedCopyInCodex")}
								</Button>
							</div>
						</div>
					</Accordion.Body>
				</Accordion.Panel>
			</Accordion.Item>
		</Accordion>
	);
}
