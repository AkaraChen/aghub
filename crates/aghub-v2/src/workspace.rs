use crate::fonts;
use crate::installed;
use crate::subscribe::{self, Category};
use aghub::db::{self, AppDb};
use aghub::plugin::{self, InstallPlugin, Plugin};
use gpui_kit::component::WindowExt as _;
use gpui_kit::component::breadcrumb::{Breadcrumb, BreadcrumbItem};
use gpui_kit::component::button::{Button, ButtonVariants as _};
use gpui_kit::component::input::{Input, InputEvent, InputState};
use gpui_kit::component::sidebar::{
	Sidebar, SidebarItem, SidebarMenu, SidebarMenuItem,
};
use gpui_kit::component::tab::{Tab, TabBar};
use gpui_kit::component::*;
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::*;
use phosphor_gpui::IconName as Phosphor;
use rust_i18n::t;

#[derive(IntoElement)]
struct PageHeader {
	breadcrumb: Breadcrumb,
	trailing: Option<AnyElement>,
}

impl PageHeader {
	fn new(items: impl IntoIterator<Item = impl Into<BreadcrumbItem>>) -> Self {
		Self {
			breadcrumb: Breadcrumb::new().children(items),
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
			.child(self.breadcrumb.min_w_0().flex_1())
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
	subscribe_category: Category,
	subscribe_plugin: Option<SharedString>,
	subscribe_search: Entity<InputState>,
	installed: Vec<Plugin>,
	installing: Option<SharedString>,
	_appearance: Subscription,
	_search: Subscription,
}

impl Workspace {
	pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
		Theme::sync_system_appearance(Some(window), cx);
		let appearance =
			cx.observe_window_appearance(window, |_, window, cx| {
				Theme::sync_system_appearance(Some(window), cx);
			});
		let placeholder = t!("subscribe.search");
		let subscribe_search = cx.new(|cx| {
			InputState::new(window, cx).placeholder(placeholder.clone())
		});
		let search =
			cx.subscribe_in(&subscribe_search, window, |_, _, event, _, cx| {
				if matches!(event, InputEvent::Change) {
					cx.notify();
				}
			});
		let mut this = Self {
			page: Page::Subscribe,
			subscribe_category: Category::All,
			subscribe_plugin: None,
			subscribe_search,
			installed: Vec::new(),
			installing: None,
			_appearance: appearance,
			_search: search,
		};
		this.reload_installed(cx);
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
		if self.page == page && self.subscribe_plugin.is_none() {
			return;
		}
		self.page = page;
		self.subscribe_plugin = None;
		window.set_window_title(&page.title());
		cx.notify();
	}

	fn open_plugin(
		&mut self,
		id: SharedString,
		window: &mut Window,
		cx: &mut Context<Self>,
	) {
		if self.subscribe_plugin.as_ref() == Some(&id) {
			return;
		}
		self.page = Page::Subscribe;
		let title = subscribe::item(&id)
			.map(|item| item.name().to_string())
			.unwrap_or_else(|| Page::Subscribe.title());
		self.subscribe_plugin = Some(id);
		window.set_window_title(&title);
		cx.notify();
	}

	fn close_plugin(&mut self, window: &mut Window, cx: &mut Context<Self>) {
		if self.subscribe_plugin.is_none() {
			return;
		}
		self.subscribe_plugin = None;
		window.set_window_title(&Page::Subscribe.title());
		cx.notify();
	}

	fn subscribe_item(&self) -> Option<&'static subscribe::Item> {
		self.subscribe_plugin
			.as_ref()
			.and_then(|id| subscribe::item(id))
	}

	fn is_installed(&self, id: &str) -> bool {
		self.installed.iter().any(|plugin| plugin.id == id)
	}

	fn reload_installed(&mut self, cx: &mut Context<Self>) {
		let conn = cx.global::<AppDb>().conn().clone();
		cx.spawn(async move |this, cx| {
			let listed =
				db::Tokio::spawn(cx, async move { plugin::list(&conn).await })
					.await;
			this.update(cx, |this, cx| {
				if let Ok(Ok(plugins)) = listed {
					this.installed = plugins;
					cx.notify();
				}
			})
			.ok();
		})
		.detach();
	}

	fn install_current_plugin(
		&mut self,
		window: &mut Window,
		cx: &mut Context<Self>,
	) {
		let Some(item) = self.subscribe_item() else {
			return;
		};
		let id = item.id().clone();
		if self.is_installed(&id) || self.installing.is_some() {
			return;
		}
		self.installing = Some(id.clone());
		cx.notify();
		let input = InstallPlugin {
			id: id.to_string(),
			name: item.name().to_string(),
			description: item.description().to_string(),
		};
		let conn = cx.global::<AppDb>().conn().clone();
		cx.spawn_in(window, async move |this, cx| {
			let result = db::Tokio::spawn(cx, async move {
				plugin::install(&conn, input).await
			})
			.await;
			this.update_in(cx, |this, window, cx| {
				this.installing = None;
				match result {
					Ok(Ok(plugin)) => {
						if !this.is_installed(&plugin.id) {
							this.installed.push(plugin);
							this.installed.sort_by(|a, b| {
								a.name.cmp(&b.name).then(a.id.cmp(&b.id))
							});
						}
					}
					_ => {
						window.push_notification(
							t!("plugins.install_failed").into_owned(),
							cx,
						);
					}
				}
				cx.notify();
			})
			.ok();
		})
		.detach();
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

	fn render_page_header(&self, cx: &mut Context<Self>) -> impl IntoElement {
		match (self.page, self.subscribe_item()) {
			(Page::Subscribe, Some(item)) => {
				let id = item.id().as_ref();
				let installed = self.is_installed(id);
				let installing = self
					.installing
					.as_ref()
					.is_some_and(|current| current == id);
				let label = if installed {
					t!("action.installed")
				} else {
					t!("action.install")
				};
				PageHeader::new([
					BreadcrumbItem::new(Page::Subscribe.title()).on_click(
						cx.listener(|this, _, window, cx| {
							this.close_plugin(window, cx);
						}),
					),
					BreadcrumbItem::new(item.category().title()),
				])
				.trailing(
					Button::new("install-plugin")
						.small()
						.label(label)
						.disabled(installed || installing)
						.loading(installing)
						.when(!installed, |this| this.primary())
						.on_click(cx.listener(|this, _, window, cx| {
							this.install_current_plugin(window, cx);
						})),
				)
			}
			(Page::Subscribe, None) => PageHeader::new([self.page.title()])
				.trailing(Self::subscribe_refresh_button()),
			_ => PageHeader::new([self.page.title()]),
		}
	}

	fn render_subscribe(&self, cx: &mut Context<Self>) -> impl IntoElement {
		if let Some(item) = self.subscribe_item() {
			return subscribe::Detail::new(item.clone()).into_any_element();
		}

		let search = t!("subscribe.search");
		v_flex()
			.flex_1()
			.min_h_0()
			.min_w_0()
			.gap_3()
			.child(
				Input::new(&self.subscribe_search)
					.cleanable(true)
					.prefix(Phosphor::MagnifyingGlass.regular())
					.aria_label(search)
					.focus_bordered(false)
					.bg(cx.theme().group_box)
					.w_full()
					.max_w(rems(25.)),
			)
			.child(
				h_flex().child(
					TabBar::new("subscribe-categories")
						.segmented()
						.selected_index(self.subscribe_category.index())
						.on_click(cx.listener(|this, index, _, cx| {
							this.subscribe_category =
								Category::from_index(*index);
							cx.notify();
						}))
						.children(Category::all().map(|category| {
							let title = category.title();
							Tab::new().aria_label(title.clone()).child(
								h_flex()
									.items_center()
									.gap_1()
									.child(category.icon())
									.child(title),
							)
						})),
				),
			)
			.child(
				subscribe::Grid::new(self.subscribe_category)
					.query(self.subscribe_search.read(cx).value())
					.on_open(cx.listener(
						|this, id: &SharedString, window, cx| {
							this.open_plugin(id.clone(), window, cx);
						},
					)),
			)
			.into_any_element()
	}

	fn render_plugins(&self, cx: &mut Context<Self>) -> impl IntoElement {
		installed::Grid::new(self.installed.clone()).on_open(cx.listener(
			|this, id: &SharedString, window, cx| {
				this.open_plugin(id.clone(), window, cx);
			},
		))
	}

	fn render_page(&self, cx: &mut Context<Self>) -> impl IntoElement {
		v_flex()
			.flex_1()
			.min_w_0()
			.min_h_0()
			.h_full()
			.bg(cx.theme().tab_bar)
			.text_color(cx.theme().foreground)
			.p_4()
			.gap_4()
			.child(self.render_page_header(cx))
			.when(self.page == Page::Subscribe, |this| {
				this.child(self.render_subscribe(cx))
			})
			.when(self.page == Page::Plugins, |this| {
				this.child(self.render_plugins(cx))
			})
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
