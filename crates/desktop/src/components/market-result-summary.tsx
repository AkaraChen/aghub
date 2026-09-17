import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

export function MarketResultSummary({
	children,
	actions,
}: {
	children: ReactNode;
	actions?: ReactNode;
}) {
	const { t } = useTranslation();
	return (
		<div className="shrink-0 border-t border-separator/70 pt-2">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div
					role="status"
					aria-label={t("searchResultsTitle")}
					className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted"
				>
					{children}
				</div>
				{actions}
			</div>
		</div>
	);
}
