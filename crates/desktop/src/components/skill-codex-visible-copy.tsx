import { ChevronDownIcon } from "@heroicons/react/24/solid";
import { Accordion, Button, Radio, RadioGroup, toast } from "@heroui/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { CodexStandaloneSkillResponse } from "../generated/dto";
import { useApi } from "../hooks/use-api";
import { selectCodexVisibleCopyMutationOptions } from "../requests/skills";

const CODEX_VISIBLE_COPY_ID = "codex-visible-copy";
const ALL_VISIBLE_COPIES = "all";

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
	const currentSelection =
		enabledCopies.length === copies.length
			? ALL_VISIBLE_COPIES
			: enabledCopies.length === 1
				? (enabledCopies[0]?.source_path ?? "")
				: "";
	const [proposedSelection, setProposedSelection] = useState<string | null>(
		null,
	);
	const [isExpanded, setIsExpanded] = useState(copies.length > 1);
	const selectedValue = proposedSelection ?? currentSelection;
	const selectionIsCurrent = selectedValue === currentSelection;
	const updateVisibility = useMutation(
		selectCodexVisibleCopyMutationOptions({
			api,
			queryClient,
			projectRoot,
			onSuccess: () => {
				setProposedSelection(null);
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
								value={selectedValue}
								onChange={setProposedSelection}
								className="grid gap-2"
								isDisabled={updateVisibility.isPending}
							>
								<Radio
									value={ALL_VISIBLE_COPIES}
									className="w-full min-w-0"
								>
									<Radio.Content className="w-full min-w-0 items-start gap-3 rounded-xl border border-border bg-surface-secondary/60 p-3 transition-colors data-[hovered=true]:bg-surface-secondary data-[selected=true]:border-accent/30 data-[selected=true]:bg-accent/5">
										<Radio.Control className="mt-0.5 shrink-0">
											<Radio.Indicator />
										</Radio.Control>
										<span className="min-w-0 flex-1">
											<span className="block text-sm font-medium text-foreground">
												{t("showAllCopiesInCodex")}
											</span>
											<span className="mt-1 block text-xs text-muted">
												{t(
													"showAllCopiesInCodexDescription",
													{ count: copies.length },
												)}
											</span>
										</span>
									</Radio.Content>
								</Radio>
								{copies.map((copy) => (
									<Radio
										key={copy.source_path}
										value={copy.source_path}
										className="w-full min-w-0"
									>
										<Radio.Content className="w-full min-w-0 items-start gap-3 rounded-xl border border-border bg-surface-secondary/60 p-3 transition-colors data-[hovered=true]:bg-surface-secondary data-[selected=true]:border-accent/30 data-[selected=true]:bg-accent/5">
											<Radio.Control className="mt-0.5 shrink-0">
												<Radio.Indicator />
											</Radio.Control>
											<span className="min-w-0 flex-1">
												<span className="block break-all font-mono text-xs text-foreground">
													{copy.source_path}
												</span>
												<span className="mt-1 block text-xs text-muted">
													{t(
														copy.enabled
															? "visibleInCodex"
															: "hiddenInCodex",
													)}
												</span>
											</span>
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
										!selectedValue || selectionIsCurrent
									}
									onPress={() => {
										if (!selectedValue) return;
										updateVisibility.mutate(
											selectedValue === ALL_VISIBLE_COPIES
												? { name, mode: "all" }
												: {
														name,
														mode: "single",
														source_path:
															selectedValue,
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
										);
									}}
								>
									{t(
										selectedValue === ALL_VISIBLE_COPIES
											? "showAllCopiesInCodex"
											: "showOnlySelectedCopyInCodex",
									)}
								</Button>
							</div>
						</div>
					</Accordion.Body>
				</Accordion.Panel>
			</Accordion.Item>
		</Accordion>
	);
}
