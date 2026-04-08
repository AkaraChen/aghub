"use client";

import { cn } from "../../lib/utils";

export function MetaRow({
	label,
	value,
	mono = false,
}: {
	label: string;
	value: string;
	mono?: boolean;
}) {
	const displayValue =
		value.length > 200 ? `${value.slice(0, 200)}...` : value;

	return (
		<div className="grid gap-1.5 py-1">
			<span className="text-[11px] font-medium tracking-wide text-muted uppercase">
				{label}
			</span>
			<span
				className={cn(
					"min-w-0 text-sm text-foreground",
					mono &&
						"overflow-x-auto rounded-md bg-surface-secondary px-3 py-2 font-mono text-xs leading-5 text-foreground",
				)}
				title={value.length > 200 ? value : undefined}
			>
				{displayValue}
			</span>
		</div>
	);
}

export function CodeBlock({
	label,
	command,
	args,
}: {
	label: string;
	command: string;
	args?: string[];
}) {
	const commandLine =
		args && args.length > 0 ? `${command} ${args.join(" ")}` : command;

	return (
		<div className="grid gap-1.5">
			<span className="text-[11px] font-medium tracking-wide text-muted uppercase">
				{label}
			</span>
			<div className="overflow-x-auto rounded-lg border border-separator bg-surface-secondary px-3 py-2">
				<code className="block font-mono text-xs leading-5 text-foreground whitespace-pre-wrap break-words">
					{commandLine}
				</code>
			</div>
		</div>
	);
}
