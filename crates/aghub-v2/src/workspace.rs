use gpui_kit::component::sidebar::{
	Sidebar, SidebarItem, SidebarMenu, SidebarMenuItem,
};
use gpui_kit::component::*;
use gpui_kit::*;
use rust_i18n::t;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Page {
	Home,
	Plugins,
	Manage,
	Settings,
}

impl Page {
	fn nav_pages() -> [Self; 3] {
		[Self::Home, Self::Plugins, Self::Manage]
	}

	fn title(self) -> String {
		match self {
			Self::Home => t!("nav.home").into(),
			Self::Plugins => t!("nav.plugins").into(),
			Self::Manage => t!("nav.manage").into(),
			Self::Settings => t!("nav.settings").into(),
		}
	}

	fn icon(self) -> IconName {
		match self {
			Self::Home => IconName::LayoutDashboard,
			Self::Plugins => IconName::Bot,
			Self::Manage => IconName::Folder,
			Self::Settings => IconName::Settings,
		}
	}
}

pub struct Workspace {
	page: Page,
	_appearance: Subscription,
}

impl Workspace {
	pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
		Theme::sync_system_appearance(Some(window), cx);
		let appearance =
			cx.observe_window_appearance(window, |_, window, cx| {
				Theme::sync_system_appearance(Some(window), cx);
			});
		let this = Self {
			page: Page::Home,
			_appearance: appearance,
		};
		window.set_window_title(&this.page.title());
		this
	}

	fn open_page(
		&mut self,
		page: Page,
		window: &mut Window,
		cx: &mut Context<Self>,
	) {
		if self.page == page {
			return;
		}
		self.page = page;
		window.set_window_title(&page.title());
		cx.notify();
	}

	fn menu_item(
		page: Page,
		current: Page,
		workspace: Entity<Self>,
	) -> SidebarMenuItem {
		SidebarMenuItem::new(page.title())
			.icon(page.icon())
			.active(current == page)
			.on_click(move |_, window, cx| {
				workspace.update(cx, |this, cx| {
					this.open_page(page, window, cx);
				});
			})
	}

	fn render_sidebar(
		&self,
		window: &mut Window,
		cx: &mut Context<Self>,
	) -> impl IntoElement {
		let workspace = cx.entity();
		let current = self.page;
		Sidebar::new("workspace-nav")
			.collapsible(false)
			.child(SidebarMenu::new().children(
				Page::nav_pages().map(|page| {
					Self::menu_item(page, current, workspace.clone())
				}),
			))
			.footer(Self::menu_item(Page::Settings, current, workspace).render(
				"workspace-nav-settings",
				window,
				cx,
			))
	}

	fn render_page(&self, cx: &mut Context<Self>) -> impl IntoElement {
		v_flex()
			.flex_1()
			.min_w_0()
			.h_full()
			.bg(cx.theme().background)
			.text_color(cx.theme().foreground)
			.p_6()
			.child(div().text_lg().child(self.page.title()))
	}
}

impl Render for Workspace {
	fn render(
		&mut self,
		window: &mut Window,
		cx: &mut Context<Self>,
	) -> impl IntoElement {
		h_flex()
			.items_stretch()
			.size_full()
			.child(self.render_sidebar(window, cx))
			.child(self.render_page(cx))
	}
}
