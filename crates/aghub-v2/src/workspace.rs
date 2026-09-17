use crate::fonts;
use gpui_kit::component::button::{Button, ButtonVariants as _};
use gpui_kit::component::sidebar::{
	Sidebar, SidebarItem, SidebarMenu, SidebarMenuItem,
};
use gpui_kit::component::*;
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::*;
use phosphor_gpui::IconName as Phosphor;
use rust_i18n::t;

#[derive(IntoElement)]
struct PageHeader {
	title: SharedString,
	trailing: Option<AnyElement>,
}

impl PageHeader {
	fn new(title: impl Into<SharedString>) -> Self {
		Self {
			title: title.into(),
			trailing: None,
		}
	}

	fn trailing(mut self, trailing: impl IntoElement) -> Self {
		self.trailing = Some(trailing.into_any_element());
		self
	}
}

impl RenderOnce for PageHeader {
	fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
		h_flex()
			.w_full()
			.items_center()
			.justify_between()
			.child(
				div()
					.min_w_0()
					.flex_1()
					.text_base()
					.font_weight(FontWeight::MEDIUM)
					.truncate()
					.child(self.title),
			)
			.when_some(self.trailing, |this, trailing| {
				this.child(div().flex_shrink_0().child(trailing))
			})
	}
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Page {
	Subscribe,
	Plugins,
	Project,
	Settings,
}

impl Page {
	fn nav_pages() -> [Self; 3] {
		[Self::Subscribe, Self::Plugins, Self::Project]
	}

	fn title(self) -> String {
		match self {
			Self::Subscribe => t!("nav.subscribe").into(),
			Self::Plugins => t!("nav.plugins").into(),
			Self::Project => t!("nav.project").into(),
			Self::Settings => t!("nav.settings").into(),
		}
	}

	fn icon(self) -> phosphor_gpui::Icon {
		match self {
			Self::Subscribe => Phosphor::Rss.duotone(),
			Self::Plugins => Phosphor::PuzzlePiece.duotone(),
			Self::Project => Phosphor::Folder.duotone(),
			Self::Settings => Phosphor::Gear.duotone(),
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
			page: Page::Subscribe,
			_appearance: appearance,
		};
		window.set_window_title(&this.page.title());
		this
	}

	fn render_title_bar(&self) -> impl IntoElement {
		TitleBar::new().child(
			div()
				.text_sm()
				.font_family(fonts::INSTRUMENT_SERIF)
				.child("aghub"),
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

	fn subscribe_refresh_button() -> impl IntoElement {
		let refresh = t!("action.refresh");
		Button::new("subscribe-refresh")
			.ghost()
			.small()
			.icon(Phosphor::ArrowClockwise.duotone())
			.tooltip(refresh.clone())
			.accessibility_label(refresh)
	}

	fn render_page_header(&self) -> impl IntoElement {
		let header = PageHeader::new(self.page.title());
		match self.page {
			Page::Subscribe => {
				header.trailing(Self::subscribe_refresh_button())
			}
			_ => header,
		}
	}

	fn render_page(&self, cx: &mut Context<Self>) -> impl IntoElement {
		v_flex()
			.flex_1()
			.min_w_0()
			.h_full()
			.bg(cx.theme().background)
			.text_color(cx.theme().foreground)
			.p_4()
			.child(self.render_page_header())
	}
}

impl Render for Workspace {
	fn render(
		&mut self,
		window: &mut Window,
		cx: &mut Context<Self>,
	) -> impl IntoElement {
		v_flex().size_full().child(self.render_title_bar()).child(
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
