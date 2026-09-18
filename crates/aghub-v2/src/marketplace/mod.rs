mod catalog;

pub use catalog::{Catalog, Category, Item};

use gpui_kit::component::alert::Alert;
use gpui_kit::component::avatar::Avatar;
use gpui_kit::component::link::Link;
use gpui_kit::component::skeleton::Skeleton;
use gpui_kit::component::*;
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::*;
use phosphor_gpui::IconName as Phosphor;
use rust_i18n::t;
use std::rc::Rc;

type OpenPlugin = Rc<dyn Fn(&SharedString, &mut Window, &mut App)>;

impl Category {
	pub fn title(self) -> String {
		match self {
			Self::All => t!("marketplace.category.all").into(),
			Self::Utilities => t!("marketplace.category.utilities").into(),
			Self::DeveloperTools => {
				t!("marketplace.category.developer_tools").into()
			}
			Self::Productivity => {
				t!("marketplace.category.productivity").into()
			}
			Self::Integrations => {
				t!("marketplace.category.integrations").into()
			}
		}
	}

	pub fn icon(self) -> phosphor_gpui::Icon {
		match self {
			Self::All => Phosphor::SquaresFour.regular(),
			Self::Utilities => Phosphor::Wrench.regular(),
			Self::DeveloperTools => Phosphor::Code.regular(),
			Self::Productivity => Phosphor::Checks.regular(),
			Self::Integrations => Phosphor::Plugs.regular(),
		}
	}
}

pub(crate) fn item_avatar(item: &Item) -> Avatar {
	let avatar = Avatar::new().name(item.name().clone());
	match item.logo_url() {
		Some(url) => avatar.src(url.clone()),
		None => avatar,
	}
}

fn chip(label: impl Into<SharedString>, cx: &App) -> impl IntoElement {
	div()
		.flex_shrink_0()
		.px_1()
		.py_0p5()
		.rounded(cx.theme().radius)
		.border_1()
		.border_color(cx.theme().border)
		.text_xs()
		.text_color(cx.theme().muted_foreground)
		.child(label.into())
}

fn keyword_chips(item: &Item, cx: &App) -> impl IntoElement {
	h_flex().min_w_0().flex_wrap().gap_1().children(
		item.keywords()
			.iter()
			.take(3)
			.cloned()
			.map(|keyword| chip(keyword, cx)),
	)
}

fn meta_line(item: &Item, cx: &App) -> impl IntoElement {
	h_flex()
		.min_w_0()
		.gap_3()
		.text_xs()
		.text_color(cx.theme().muted_foreground)
		.child(
			div().truncate().child(SharedString::from(
				t!("marketplace.created_by", name = item.author().as_ref())
					.into_owned(),
			)),
		)
		.when(!item.skills().is_empty(), |this| {
			this.child(
				div().child(SharedString::from(
					t!("marketplace.skill_count", count = item.skills().len())
						.into_owned(),
				)),
			)
		})
		.when(!item.mcp().is_empty(), |this| {
			this.child(
				div().child(SharedString::from(
					t!("marketplace.mcp_count", count = item.mcp().len())
						.into_owned(),
				)),
			)
		})
}

#[derive(IntoElement)]
struct Card {
	item: Item,
	on_open: Option<OpenPlugin>,
}

impl RenderOnce for Card {
	fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
		let item = self.item;
		let id = item.id.clone();
		let version = item.version().clone();
		let license = item.license().clone();
		v_flex()
			.id(id.clone())
			.w_full()
			.min_w_0()
			.p_4()
			.gap_2()
			.rounded(cx.theme().radius)
			.bg(cx.theme().group_box)
			.border_1()
			.border_color(cx.theme().border)
			.hover(|this| this.bg(cx.theme().muted))
			.when_some(self.on_open, |this, on_open| {
				this.on_click(move |_, window, cx| on_open(&id, window, cx))
			})
			.child(
				h_flex()
					.min_w_0()
					.items_center()
					.gap_2()
					.child(item_avatar(&item).small())
					.child(
						v_flex().min_w_0().flex_1().child(
							div()
								.text_sm()
								.font_weight(FontWeight::MEDIUM)
								.truncate()
								.child(item.name().clone()),
						),
					)
					.when(!version.is_empty(), |this| {
						this.child(chip(format!("v{version}"), cx))
					}),
			)
			.child(
				div()
					.min_w_0()
					.h(rems(2.5))
					.text_sm()
					.line_height(rems(1.25))
					.text_color(cx.theme().muted_foreground)
					.text_ellipsis()
					.line_clamp(2)
					.child(item.description().clone()),
			)
			.child(keyword_chips(&item, cx))
			.child(
				h_flex()
					.min_w_0()
					.items_center()
					.justify_between()
					.gap_2()
					.child(meta_line(&item, cx))
					.when(!license.is_empty(), |this| {
						this.child(chip(license, cx))
					}),
			)
	}
}

#[derive(IntoElement)]
pub struct Detail {
	item: Item,
}

impl Detail {
	pub fn new(item: Item) -> Self {
		Self { item }
	}
}

fn section_heading(label: String, count: usize, cx: &App) -> impl IntoElement {
	h_flex()
		.gap_1()
		.child(div().text_sm().font_weight(FontWeight::MEDIUM).child(label))
		.child(
			div()
				.text_sm()
				.text_color(cx.theme().muted_foreground)
				.child(count.to_string()),
		)
}

fn entry_row(
	id: impl Into<ElementId>,
	title: SharedString,
	cx: &App,
) -> impl IntoElement {
	div()
		.id(id)
		.w_full()
		.min_w_0()
		.px_2()
		.py_1p5()
		.rounded(cx.theme().radius)
		.bg(cx.theme().group_box)
		.border_1()
		.border_color(cx.theme().border)
		.text_sm()
		.font_weight(FontWeight::MEDIUM)
		.truncate()
		.child(title)
}

fn name_list(
	prefix: &'static str,
	label: String,
	names: &[SharedString],
	cx: &App,
) -> impl IntoElement {
	v_flex()
		.w_full()
		.gap_3()
		.child(section_heading(label, names.len(), cx))
		.children(names.iter().enumerate().map(|(ix, name)| {
			entry_row(format!("{prefix}-{ix}-{name}"), name.clone(), cx)
		}))
}

impl RenderOnce for Detail {
	fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
		let item = self.item;
		let version = item.version().clone();
		let license = item.license().clone();
		let author = item.author().clone();
		v_flex()
			.id("marketplace-plugin")
			.flex_1()
			.min_h_0()
			.min_w_0()
			.overflow_y_scroll()
			.gap_6()
			.child(
				h_flex()
					.w_full()
					.items_start()
					.gap_3()
					.child(item_avatar(&item).large())
					.child(
						v_flex()
							.min_w_0()
							.flex_1()
							.gap_2()
							.child(
								h_flex()
									.min_w_0()
									.items_center()
									.gap_2()
									.child(
										div()
											.text_lg()
											.font_weight(FontWeight::MEDIUM)
											.child(item.name().clone()),
									)
									.when(!version.is_empty(), |this| {
										this.child(chip(
											format!("v{version}"),
											cx,
										))
									})
									.when(!license.is_empty(), |this| {
										this.child(chip(license, cx))
									}),
							)
							.child(
								div()
									.text_sm()
									.line_height(rems(1.25))
									.text_color(cx.theme().muted_foreground)
									.child(item.description().clone()),
							)
							.child(
								h_flex()
									.gap_3()
									.child(
										div()
											.text_sm()
											.text_color(
												cx.theme().muted_foreground,
											)
											.child(SharedString::from(
												t!(
													"marketplace.created_by",
													name = author.as_ref()
												)
												.into_owned(),
											)),
									)
									.child(
										Link::new("plugin-source")
											.href(item.homepage().to_string())
											.text_sm()
											.child(SharedString::from(
												t!("marketplace.view_source")
													.into_owned(),
											)),
									),
							)
							.child(keyword_chips(&item, cx)),
					),
			)
			.when(!item.skills().is_empty(), |this| {
				this.child(name_list(
					"skill",
					t!("marketplace.skills").into(),
					item.skills(),
					cx,
				))
			})
			.when(!item.mcp().is_empty(), |this| {
				this.child(name_list(
					"mcp",
					t!("marketplace.mcp").into(),
					item.mcp(),
					cx,
				))
			})
	}
}

#[derive(IntoElement)]
pub struct Grid {
	category: Category,
	query: SharedString,
	catalog: Option<Entity<Catalog>>,
	on_open: Option<OpenPlugin>,
}

impl Grid {
	pub fn new(category: Category) -> Self {
		Self {
			category,
			query: SharedString::default(),
			catalog: None,
			on_open: None,
		}
	}

	pub fn query(mut self, query: impl Into<SharedString>) -> Self {
		self.query = query.into();
		self
	}

	pub fn catalog(mut self, catalog: Entity<Catalog>) -> Self {
		self.catalog = Some(catalog);
		self
	}

	pub fn on_open(
		mut self,
		on_open: impl Fn(&SharedString, &mut Window, &mut App) + 'static,
	) -> Self {
		self.on_open = Some(Rc::new(on_open));
		self
	}
}

fn loading_cards() -> impl IntoElement {
	div()
		.w_full()
		.grid()
		.grid_cols(2)
		.gap_3()
		.children((0..4).map(|_| {
			v_flex()
				.w_full()
				.p_4()
				.gap_2()
				.rounded_full()
				.child(
					h_flex()
						.items_center()
						.gap_2()
						.child(Skeleton::new().size_8().rounded_full())
						.child(Skeleton::new().h_4().flex_1()),
				)
				.child(Skeleton::new().h(rems(2.5)).w_full())
				.child(Skeleton::new().h_4().w(rems(12.)))
		}))
}

impl RenderOnce for Grid {
	fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
		let Some(catalog) =
			self.catalog.as_ref().map(|catalog| catalog.read(cx))
		else {
			return div().id("marketplace-catalog").flex_1().min_h_0();
		};
		let items = catalog.visible(self.category, self.query.as_ref());
		let loading = catalog.is_loading();
		let error = catalog.error().cloned();
		let empty = if self.query.trim().is_empty() {
			t!("marketplace.empty")
		} else {
			t!("marketplace.empty_search")
		};

		div()
			.id("marketplace-catalog")
			.flex_1()
			.min_h_0()
			.min_w_0()
			.overflow_y_scroll()
			.when(loading && items.is_empty(), |this| {
				this.child(
					v_flex()
						.w_full()
						.gap_2()
						.child(
							div()
								.text_sm()
								.text_color(cx.theme().muted_foreground)
								.child(SharedString::from(
									t!("marketplace.loading").into_owned(),
								)),
						)
						.child(loading_cards()),
				)
			})
			.when_some(error.clone(), |this, error| {
				this.child(
					Alert::error("marketplace-load-failed", error).title(
						SharedString::from(
							t!("marketplace.load_failed").into_owned(),
						),
					),
				)
			})
			.when(!loading && error.is_none() && items.is_empty(), |this| {
				this.child(
					div()
						.text_sm()
						.text_color(cx.theme().muted_foreground)
						.child(SharedString::from(empty.into_owned())),
				)
			})
			.when(!items.is_empty(), |this| {
				this.child(div().w_full().grid().grid_cols(2).gap_3().children(
					items.into_iter().map(|item| Card {
						item,
						on_open: self.on_open.clone(),
					}),
				))
			})
	}
}
