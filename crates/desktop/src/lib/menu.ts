import { emit } from "@tauri-apps/api/event";
import {
	Menu,
	MenuItem,
	PredefinedMenuItem,
	Submenu,
} from "@tauri-apps/api/menu";
import type { TFunction } from "i18next";

let activeAppMenu: Menu | null = null;

export async function setupAppMenu(t: TFunction) {
	try {
		const aboutMenuItem = await MenuItem.new({
			id: "about",
			text: t("menu.about"),
			action: () => {
				emit("navigate", "/settings?tab=application");
			},
		});

		const settingsMenuItem = await MenuItem.new({
			id: "settings",
			text: t("menu.settings"),
			accelerator: "CmdOrControl+,",
			action: () => {
				emit("navigate", "/settings");
			},
		});

		const appSubmenu = await Submenu.new({
			text: t("menu.app"),
			items: [
				aboutMenuItem,
				await PredefinedMenuItem.new({ item: "Separator" }),
				settingsMenuItem,
				await PredefinedMenuItem.new({ item: "Separator" }),
				await PredefinedMenuItem.new({
					item: "Services",
					text: t("menu.services"),
				}),
				await PredefinedMenuItem.new({ item: "Separator" }),
				await PredefinedMenuItem.new({
					item: "Hide",
					text: t("menu.hide"),
				}),
				await PredefinedMenuItem.new({
					item: "HideOthers",
					text: t("menu.hideOthers"),
				}),
				await PredefinedMenuItem.new({
					item: "ShowAll",
					text: t("menu.showAll"),
				}),
				await PredefinedMenuItem.new({ item: "Separator" }),
				await PredefinedMenuItem.new({
					item: "Quit",
					text: t("menu.quit"),
				}),
			],
		});

		const discoverSkillsMenuItem = await MenuItem.new({
			id: "discover-skills",
			text: t("menu.discoverSkills"),
			accelerator: "CmdOrControl+D",
			action: () => emit("navigate", "/skills-sh"),
		});

		const manageMcpMenuItem = await MenuItem.new({
			id: "manage-mcp",
			text: t("menu.manageMcp"),
			accelerator: "CmdOrControl+M",
			action: () => emit("navigate", "/mcp"),
		});

		const newAgentMenuItem = await MenuItem.new({
			id: "new-agent",
			text: t("menu.newAgent"),
			accelerator: "CmdOrControl+N",
			action: () => emit("navigate", "/settings/custom-agents"),
		});

		const agentSubmenu = await Submenu.new({
			text: t("menu.agent"),
			items: [
				newAgentMenuItem,
				await PredefinedMenuItem.new({ item: "Separator" }),
				discoverSkillsMenuItem,
				manageMcpMenuItem,
			],
		});

		const searchMenuItem = await MenuItem.new({
			id: "search",
			text: t("menu.search"),
			accelerator: "CmdOrControl+F",
			action: () => {
				emit("window-search-requested");
			},
		});

		const editSubmenu = await Submenu.new({
			text: t("menu.edit"),
			items: [
				await PredefinedMenuItem.new({
					item: "Undo",
					text: t("menu.undo"),
				}),
				await PredefinedMenuItem.new({
					item: "Redo",
					text: t("menu.redo"),
				}),
				await PredefinedMenuItem.new({ item: "Separator" }),
				await PredefinedMenuItem.new({
					item: "Cut",
					text: t("menu.cut"),
				}),
				await PredefinedMenuItem.new({
					item: "Copy",
					text: t("menu.copy"),
				}),
				await PredefinedMenuItem.new({
					item: "Paste",
					text: t("menu.paste"),
				}),
				await PredefinedMenuItem.new({
					item: "SelectAll",
					text: t("menu.selectAll"),
				}),
				await PredefinedMenuItem.new({ item: "Separator" }),
				searchMenuItem,
			],
		});

		const controlSubmenu = await Submenu.new({
			text: t("menu.control"),
			items: [
				await PredefinedMenuItem.new({
					item: "CloseWindow",
					text: t("menu.close"),
				}),
				await PredefinedMenuItem.new({ item: "Separator" }),
				await PredefinedMenuItem.new({
					item: "Minimize",
					text: t("menu.minimize"),
				}),
				await PredefinedMenuItem.new({
					item: "Maximize",
					text: t("menu.zoom"),
				}),
				await PredefinedMenuItem.new({
					item: "Fullscreen",
					text: t("menu.toggleFullscreen"),
				}),
			],
		});

		activeAppMenu = await Menu.new({
			items: [appSubmenu, agentSubmenu, editSubmenu, controlSubmenu],
		});

		const isMac = navigator.userAgent.toLowerCase().includes("mac");
		if (isMac) {
			await activeAppMenu.setAsAppMenu();
		}
	} catch (e) {
		console.error("Failed to set app menu", e);
	}
}
