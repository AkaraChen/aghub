import { CpuChipIcon, PlusIcon } from "@heroicons/react/24/solid";
import { Button, SearchField } from "@heroui/react";
import { useState } from "react";
import {
	Empty,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "../../components/ui/empty";

export default function CustomAgentsPage() {
	const [searchQuery, setSearchQuery] = useState("");

	return (
		<div className="flex h-full">
			{/* Agents List Panel */}
			<div className="flex w-80 shrink-0 flex-col border-r border-border">
				{/* Search Header */}
				<div className="flex items-center gap-2 p-3">
					<SearchField
						value={searchQuery}
						onChange={setSearchQuery}
						aria-label="Search agents"
						variant="secondary"
						className="flex-1"
					>
						<SearchField.Group>
							<SearchField.SearchIcon />
							<SearchField.Input placeholder="Search agents..." />
							<SearchField.ClearButton />
						</SearchField.Group>
					</SearchField>
					<Button isIconOnly variant="ghost" size="sm">
						<PlusIcon className="size-4" />
					</Button>
				</div>

				{/* Empty State */}
				<div className="flex flex-1 items-center justify-center p-6">
					<Empty className="border-0">
						<EmptyHeader>
							<EmptyMedia>
								<CpuChipIcon className="size-8 text-muted" />
							</EmptyMedia>
							<EmptyTitle className="text-sm font-normal text-muted">
								No agents
							</EmptyTitle>
						</EmptyHeader>
						<Button variant="outline" size="sm">
							<PlusIcon className="mr-1 size-4" />
							Create agent
						</Button>
					</Empty>
				</div>
			</div>

			{/* Detail Panel - Empty State */}
			<div className="flex flex-1 items-center justify-center">
				<Empty className="border-0">
					<EmptyHeader>
						<EmptyMedia>
							<CpuChipIcon className="size-8 text-muted" />
						</EmptyMedia>
						<EmptyTitle className="text-sm font-normal text-muted">
							No custom agents found
						</EmptyTitle>
					</EmptyHeader>
					<Button variant="outline" size="sm">
						<PlusIcon className="mr-1 size-4" />
						Create your first agent
					</Button>
				</Empty>
			</div>
		</div>
	);
}
