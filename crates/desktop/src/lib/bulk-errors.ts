export interface BulkFailedItem {
	name: string;
	agent?: string | null;
}

export class BulkOperationError extends Error {
	constructor(public readonly failures: BulkFailedItem[]) {
		super(`${failures.length} operations failed`);
		this.name = "BulkOperationError";
	}
}

const PREVIEW_COUNT = 3;

export function bulkFailureItemsLabel(failures: BulkFailedItem[]): {
	count: number;
	items: string;
} {
	const previews = failures
		.slice(0, PREVIEW_COUNT)
		.map((item) =>
			item.agent ? `${item.name} (${item.agent})` : item.name,
		);
	const remaining = failures.length - previews.length;
	return {
		count: failures.length,
		items:
			remaining > 0
				? `${previews.join(", ")}, +${remaining}`
				: previews.join(", "),
	};
}
