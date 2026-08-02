import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type {
	SkillDirectoryDiffResponse,
	SkillFileDiffResponse,
} from "../generated/dto";
import { cn } from "../lib/utils";
import { SkillLinkState } from "./skill-link-state";

// Bounds the LCS matrix used for line highlighting before the render budget
// decides whether a text preview is shown.
const MAX_LINE_DIFF_CELLS = 250_000;
const MAX_RENDERED_DIFF_FILES = 100;
const MAX_RENDERED_DIFF_LINES = 2_000;

type DiffLineKind = "context" | "added" | "removed";

interface DiffLine {
	kind: DiffLineKind;
	text: string;
	oldLine?: number;
	newLine?: number;
}

interface PreparedFileDiff {
	file: SkillFileDiffResponse;
	lines: DiffLine[];
	previewOmitted: boolean;
}

export function SkillFileDiffView({
	diff,
	baseLabel,
	targetLabel,
	reverse = false,
}: {
	diff: SkillDirectoryDiffResponse;
	baseLabel: string;
	targetLabel: string;
	reverse?: boolean;
}) {
	const { t } = useTranslation();
	const prepared = useMemo(
		() => prepareFileDiffs(diff, reverse),
		[diff, reverse],
	);

	return (
		<div className="space-y-3">
			<div className="grid gap-2 text-xs text-muted sm:grid-cols-2">
				<p className="min-w-0 truncate" title={baseLabel}>
					<span className="font-medium text-foreground">−</span>{" "}
					{baseLabel}
				</p>
				<p className="min-w-0 truncate" title={targetLabel}>
					<span className="font-medium text-foreground">+</span>{" "}
					{targetLabel}
				</p>
			</div>
			{prepared.files.length > 0 && (
				<div className="divide-y divide-separator/70 border-y border-separator/70">
					{prepared.files.map((file) => (
						<SkillFileChange key={file.file.path} {...file} />
					))}
				</div>
			)}
			{prepared.filesOmitted > 0 && (
				<p className="text-xs text-muted" role="status">
					{t("diffFilesOmitted", {
						count: prepared.filesOmitted,
					})}
				</p>
			)}
		</div>
	);
}

function SkillFileChange({ file, lines, previewOmitted }: PreparedFileDiff) {
	const { t } = useTranslation();
	const label =
		file.change === "added"
			? t("diffFileAdded")
			: file.change === "removed"
				? t("diffFileRemoved")
				: t("diffFileModified");

	return (
		<section data-skill-diff-file className="py-3">
			<header className="flex items-center justify-between gap-3 px-1">
				<code className="min-w-0 truncate text-xs text-foreground">
					{file.path}
				</code>
				<span
					className={cn(
						"shrink-0 text-xs text-muted",
						file.change === "added" && "text-success",
						file.change === "removed" && "text-danger",
					)}
				>
					{label}
				</span>
			</header>
			{file.before_link || file.after_link ? (
				<SkillLinkChange file={file} />
			) : file.content_omitted || previewOmitted ? (
				<p className="mt-2 border-t border-separator/60 px-1 pt-3 text-xs text-muted">
					{t(
						previewOmitted
							? "diffPreviewTruncated"
							: "diffPreviewUnavailable",
					)}
				</p>
			) : (
				<div
					role="region"
					aria-label={t("diffForFile", { path: file.path })}
					className="mt-2 max-h-72 overflow-auto border-t border-separator/60 pt-2 font-mono text-xs"
				>
					{lines.map((line) => (
						<DiffLineRow
							key={`${line.kind}:${line.oldLine ?? "-"}:${line.newLine ?? "-"}`}
							line={line}
						/>
					))}
				</div>
			)}
		</section>
	);
}

function SkillLinkChange({ file }: { file: SkillFileDiffResponse }) {
	const { t } = useTranslation();

	return (
		<div
			role="region"
			aria-label={t("diffForFile", { path: file.path })}
			className="mt-2 space-y-2 border-t border-separator/60 px-1 pt-3"
		>
			<SkillLinkVersion
				side="before"
				marker="−"
				link={file.before_link}
				exists={file.change !== "added"}
			/>
			<SkillLinkVersion
				side="after"
				marker="+"
				link={file.after_link}
				exists={file.change !== "removed"}
			/>
		</div>
	);
}

function SkillLinkVersion({
	side,
	marker,
	link,
	exists,
}: {
	side: "before" | "after";
	marker: "−" | "+";
	link: SkillFileDiffResponse["before_link"];
	exists: boolean;
}) {
	const { t } = useTranslation();

	return (
		<div
			data-skill-file-version={side}
			className="grid min-w-0 grid-cols-[1rem_minmax(0,1fr)] items-start gap-2 text-xs"
		>
			<span
				className="text-center font-medium text-muted"
				aria-hidden="true"
			>
				{marker}
			</span>
			<div className="grid min-w-0 gap-1 sm:grid-cols-[5.5rem_minmax(0,1fr)] sm:items-center sm:gap-3">
				<span className="text-foreground">
					{link
						? t("symlink")
						: t(exists ? "diffRegularFile" : "diffVersionAbsent")}
				</span>
				{link && <SkillLinkState link={link} />}
			</div>
		</div>
	);
}

function prepareFileDiffs(
	diff: SkillDirectoryDiffResponse,
	reverse: boolean,
): {
	files: PreparedFileDiff[];
	filesOmitted: number;
} {
	let remainingLines = MAX_RENDERED_DIFF_LINES;
	const displayedFiles = diff.files.slice(0, MAX_RENDERED_DIFF_FILES);
	const files = displayedFiles.map((sourceFile) => {
		const file = reverse ? reverseFileDiff(sourceFile) : sourceFile;
		if (file.before_link || file.after_link) {
			return { file, lines: [], previewOmitted: false };
		}
		if (file.content_omitted) {
			return { file, lines: [], previewOmitted: false };
		}

		const lineBudget =
			countTextLines(file.before) + countTextLines(file.after);
		if (lineBudget > remainingLines) {
			return { file, lines: [], previewOmitted: true };
		}

		const lines = buildLineDiff(file.before, file.after);
		remainingLines -= lines.length;
		return { file, lines, previewOmitted: false };
	});

	return {
		files,
		filesOmitted:
			diff.files_omitted +
			Math.max(0, diff.files.length - displayedFiles.length),
	};
}

function reverseFileDiff(file: SkillFileDiffResponse): SkillFileDiffResponse {
	return {
		...file,
		change:
			file.change === "added"
				? "removed"
				: file.change === "removed"
					? "added"
					: "modified",
		before: file.after,
		after: file.before,
		before_link: file.after_link,
		after_link: file.before_link,
	};
}

function countTextLines(content: string | null): number {
	if (content === null) return 0;
	let lines = 1;
	for (let index = 0; index < content.length; index += 1) {
		if (content.charCodeAt(index) === 10) lines += 1;
	}
	return lines;
}

function DiffLineRow({ line }: { line: DiffLine }) {
	const marker =
		line.kind === "added" ? "+" : line.kind === "removed" ? "−" : " ";

	return (
		<div
			data-diff-kind={line.kind}
			className={cn(
				"grid min-w-max grid-cols-[3rem_3rem_1.25rem_minmax(0,1fr)] px-2",
				line.kind === "added" && "bg-success/10 text-success",
				line.kind === "removed" && "bg-danger/10 text-danger",
			)}
		>
			<span className="select-none text-right text-muted">
				{line.oldLine ?? ""}
			</span>
			<span className="select-none text-right text-muted">
				{line.newLine ?? ""}
			</span>
			<span className="select-none text-center">{marker}</span>
			<code className="pr-3 whitespace-pre">{line.text || " "}</code>
		</div>
	);
}

function buildLineDiff(
	before: string | null,
	after: string | null,
): DiffLine[] {
	const oldLines = before?.split("\n") ?? [];
	const newLines = after?.split("\n") ?? [];
	if ((oldLines.length + 1) * (newLines.length + 1) > MAX_LINE_DIFF_CELLS) {
		return [
			...oldLines.map((text, index) => ({
				kind: "removed" as const,
				text,
				oldLine: index + 1,
			})),
			...newLines.map((text, index) => ({
				kind: "added" as const,
				text,
				newLine: index + 1,
			})),
		];
	}

	const common = Array.from(
		{ length: oldLines.length + 1 },
		() => new Uint32Array(newLines.length + 1),
	);
	for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex -= 1) {
		for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex -= 1) {
			common[oldIndex][newIndex] =
				oldLines[oldIndex] === newLines[newIndex]
					? common[oldIndex + 1][newIndex + 1] + 1
					: Math.max(
							common[oldIndex + 1][newIndex],
							common[oldIndex][newIndex + 1],
						);
		}
	}

	const lines: DiffLine[] = [];
	let oldIndex = 0;
	let newIndex = 0;
	while (oldIndex < oldLines.length || newIndex < newLines.length) {
		if (
			oldIndex < oldLines.length &&
			newIndex < newLines.length &&
			oldLines[oldIndex] === newLines[newIndex]
		) {
			lines.push({
				kind: "context",
				text: oldLines[oldIndex],
				oldLine: oldIndex + 1,
				newLine: newIndex + 1,
			});
			oldIndex += 1;
			newIndex += 1;
		} else if (
			newIndex >= newLines.length ||
			(oldIndex < oldLines.length &&
				common[oldIndex + 1][newIndex] >=
					common[oldIndex][newIndex + 1])
		) {
			lines.push({
				kind: "removed",
				text: oldLines[oldIndex],
				oldLine: oldIndex + 1,
			});
			oldIndex += 1;
		} else {
			lines.push({
				kind: "added",
				text: newLines[newIndex],
				newLine: newIndex + 1,
			});
			newIndex += 1;
		}
	}

	return lines;
}
