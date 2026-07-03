import { expect, test } from "@playwright/test";
import { dragSelectionPayload } from "../src/lib/drag-payload";

// react-aria hands getItems only the grabbed item's section slice; the
// full-drop path can't be exercised through synthetic DragEvents, so the
// cross-section serialization is guarded here at the unit level.

test("unselected item drags on its own", () => {
	const payload = dragSelectionPayload(["solo"], new Set());
	expect(payload).toEqual(["solo"]);
});

test("dragging within a selection carries the whole selection", () => {
	// react-aria truncated the grabbed keys to one section ("solo"),
	// but the selection spans two sections
	const selection = new Set(["react-pro", "solo"]);
	const payload = dragSelectionPayload(["solo"], selection);
	expect([...payload].sort()).toEqual(["react-pro", "solo"]);
});

test("dragging an unselected item ignores an unrelated selection", () => {
	const selection = new Set(["react-pro", "solo"]);
	const payload = dragSelectionPayload(["other"], selection);
	expect(payload).toEqual(["other"]);
});
