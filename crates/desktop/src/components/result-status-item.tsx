import { CheckCircleIcon, XCircleIcon } from "@heroicons/react/24/solid";
import { Spinner } from "@heroui/react";

interface ResultStatusItemProps {
	displayName: string;
	status: "pending" | "success" | "error";
	statusText: string;
	error?: string;
}

export function ResultStatusItem({
	displayName,
	status,
	statusText,
	error,
}: ResultStatusItemProps) {
	return (
		<div className="flex items-start gap-2 rounded-lg bg-surface-secondary p-3">
			{status === "pending" && (
				<Spinner
					color="current"
					size="sm"
					className="mt-0.5 shrink-0 text-muted"
				/>
			)}
			{status === "success" && (
				<CheckCircleIcon className="mt-0.5 size-4 shrink-0 text-success" />
			)}
			{status === "error" && (
				<XCircleIcon className="mt-0.5 size-4 shrink-0 text-danger" />
			)}
			<div className="min-w-0">
				<p className="text-sm font-medium">{displayName}</p>
				<p className="text-xs text-muted">{error || statusText}</p>
			</div>
		</div>
	);
}
