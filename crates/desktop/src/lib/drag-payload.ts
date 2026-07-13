/**
 * Keys to serialize when a list item drag starts.
 *
 * Each group section is its own react-aria ListBox collection, so a
 * drag that grabs a selected item is truncated by react-aria to just
 * that section's slice of the selection. When the grabbed item belongs
 * to the current selection we carry the whole cross-section selection
 * instead, so dropping moves every selected item — not only the ones in
 * the grabbed item's section. An unselected item drags on its own.
 */
export function dragSelectionPayload(
	draggedKeys: Iterable<string>,
	selectedKeys: Set<string>,
): string[] {
	const dragged = [...draggedKeys].map(String);
	return dragged.some((key) => selectedKeys.has(key))
		? [...selectedKeys]
		: dragged;
}
