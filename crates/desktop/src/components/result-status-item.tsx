import {
	ArrowPathIcon,
	CheckCircleIcon,
	XCircleIcon,
} from "@heroicons/react/24/solid";

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
		<div className="flex items-start gap-2 p-3 rounded-lg bg-default-50">
			{status === "pending" && (
				<ArrowPathIcon className="size-4 text-muted shrink-0 mt-0.5 animate-spin" />
			)}
			{status === "success" && (
				<CheckCircleIcon className="size-4 text-success shrink-0 mt-0.5" />
			)}
			{status === "error" && (
				<XCircleIcon className="size-4 text-danger shrink-0 mt-0.5" />
			)}
			<div className="min-w-0">
				<p className="text-sm font-medium">{displayName}</p>
				<p className="text-xs text-muted">{error || statusText}</p>
			</div>
		</div>
	);
}