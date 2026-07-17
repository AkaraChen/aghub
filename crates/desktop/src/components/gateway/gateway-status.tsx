import { PowerIcon } from "@heroicons/react/24/solid";
import { useTranslation } from "react-i18next";
import type { GatewayInstanceStatus } from "../../generated/dto";
import { cn } from "../../lib/utils";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "../ui/empty";
import { GATEWAY_STATUS_DISPLAY } from "./gateway-helpers";

export function GatewayStatusIndicator({
	status,
	className,
}: {
	status: GatewayInstanceStatus;
	className?: string;
}) {
	const { t } = useTranslation();
	const display = GATEWAY_STATUS_DISPLAY[status];

	return (
		<span
			className={cn(
				"flex shrink-0 items-center gap-1.5 text-xs text-muted",
				className,
			)}
		>
			<span
				className={cn("size-2 rounded-full", display.dotClass)}
				aria-hidden
			/>
			{t(display.labelKey)}
		</span>
	);
}

export function GatewayNotRunningNotice() {
	const { t } = useTranslation();
	return (
		<Empty className="mt-2">
			<EmptyHeader>
				<EmptyMedia variant="icon">
					<PowerIcon />
				</EmptyMedia>
				<EmptyTitle>{t("gatewayInstanceNotRunning")}</EmptyTitle>
				<EmptyDescription>
					{t("gatewayInstanceNotRunningDescription")}
				</EmptyDescription>
			</EmptyHeader>
		</Empty>
	);
}
