import { getStore } from ".";

const SIDEBAR_ORDER_KEY = "sidebar_order";
const SIDEBAR_HIDDEN_KEY = "sidebar_hidden";

export type MenuItemId = "mcp" | "skills" | "skills-sh" | "sub-agents";

export const DEFAULT_ORDER: MenuItemId[] = ["mcp", "skills", "skills-sh", "sub-agents"];

export async function getSidebarOrder(): Promise<MenuItemId[]> {
	const store = await getStore();
	const order = await store.get<MenuItemId[]>(SIDEBAR_ORDER_KEY);
	return order ?? DEFAULT_ORDER;
}

export async function setSidebarOrder(order: MenuItemId[]): Promise<void> {
	const store = await getStore();
	await store.set(SIDEBAR_ORDER_KEY, order);
	await store.save();
}

export async function getHiddenItems(): Promise<MenuItemId[]> {
	const store = await getStore();
	const hidden = await store.get<MenuItemId[]>(SIDEBAR_HIDDEN_KEY);
	return hidden ?? [];
}

export async function setHiddenItems(hidden: MenuItemId[]): Promise<void> {
	const store = await getStore();
	await store.set(SIDEBAR_HIDDEN_KEY, hidden);
	await store.save();
}

export async function hideItem(itemId: MenuItemId): Promise<void> {
	const hidden = await getHiddenItems();
	if (!hidden.includes(itemId)) {
		hidden.push(itemId);
		await setHiddenItems(hidden);
	}
}

export async function showItem(itemId: MenuItemId): Promise<void> {
	const hidden = await getHiddenItems();
	const index = hidden.indexOf(itemId);
	if (index > -1) {
		hidden.splice(index, 1);
		await setHiddenItems(hidden);
	}
}
