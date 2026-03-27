import { SearchField } from "@heroui/react";
import type { ReactNode } from "react";

interface ListSearchHeaderProps {
	searchValue: string;
	onSearchChange: (value: string) => void;
	placeholder?: string;
	ariaLabel?: string;
	children?: ReactNode;
}

export function ListSearchHeader({
	searchValue,
	onSearchChange,
	placeholder,
	ariaLabel,
	children,
}: ListSearchHeaderProps) {
	return (
		<div className="flex items-center gap-2 p-3">
			<SearchField
				value={searchValue}
				onChange={onSearchChange}
				aria-label={ariaLabel}
				className="min-w-0 flex-1"
			>
				<SearchField.Group>
					<SearchField.SearchIcon />
					<SearchField.Input placeholder={placeholder} />
					<SearchField.ClearButton />
				</SearchField.Group>
			</SearchField>
			{children}
		</div>
	);
}
