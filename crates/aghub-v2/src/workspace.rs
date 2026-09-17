use gpui_kit::component::select::{Select, SelectState};
use gpui_kit::component::sidebar::{
	Sidebar, SidebarItem, SidebarMenu, SidebarMenuItem,
};
use gpui_kit::component::*;
use gpui_kit::*;
use phosphor_gpui::IconName as Phosphor;

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

	fn title(self) -> &'static str {
		match self {
			Self::Home => "主页",
			Self::Plugins => "插件",
			Self::Manage => "管理",
			Self::Settings => "设置",
		}
	}

	fn icon(self) -> phosphor_gpui::Icon {
		match self {
			Self::Home => Phosphor::House.duotone(),
			Self::Plugins => Phosphor::PuzzlePiece.duotone(),
			Self::Manage => Phosphor::Folder.duotone(),
			Self::Settings => Phosphor::Gear.duotone(),
		}
	}
}

pub struct Workspace {
	page: Page,
	scope: Entity<SelectState<Vec<SharedString>>>,
	_appearance: Subscription,
}

impl Workspace {
	pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
		Theme::sync_system_appearance(Some(window), cx);
		let appearance =
			cx.observe_window_appearance(window, |_, window, cx| {
				Theme::sync_system_appearance(Some(window), cx);
			});
		let scope = cx.new(|cx| {
			SelectState::new(Vec::<SharedString>::new(), None, window, cx)
		});
		let this = Self {
			page: Page::Home,
			scope,
			_appearance: appearance,
		};
		window.set_window_title(this.page.title());
		this
	}

	fn render_title_bar(&self, cx: &mut Context<Self>) -> impl IntoElement {
		TitleBar::new()
			.child(
				div()
					.text_sm()
					.font_weight(FontWeight::MEDIUM)
					.child("aghub"),
			)
			.child(
				h_flex().items_center().pr_3().child(
					h_flex()
						.id("scope-switcher")
						.items_center()
						.bg(cx.theme().secondary)
						.border_1()
						.border_color(cx.theme().border)
						.rounded(cx.theme().radius)
						.hover(|this| this.bg(cx.theme().secondary_hover))
						.child(
							Select::new(&self.scope)
								.xsmall()
								.w_32()
								.appearance(false)
								.placeholder("Scope")
								.accessibility_label("Scope"),
						),
				),
			)
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
		window.set_window_title(page.title());
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
		v_flex().size_full().child(self.render_title_bar(cx)).child(
			h_flex()
				.items_stretch()
				.flex_1()
				.min_h_0()
				.w_full()
				.child(self.render_sidebar(window, cx))
				.child(self.render_page(cx)),
		)
	}
}
