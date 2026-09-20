mod catalog;
mod docs;

pub use catalog::{Catalog, Category, Item};
pub use docs::{Doc, Docs, Manifest};

use gpui_kit::Size;
use gpui_kit::component::alert::Alert;
use gpui_kit::component::avatar::Avatar;
use gpui_kit::component::link::Link;
use gpui_kit::component::scroll::Scrollbar;
use gpui_kit::component::skeleton::Skeleton;
use gpui_kit::component::text::TextView;
use gpui_kit::component::*;
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::*;
use phosphor_gpui::IconName as Phosphor;
use rust_i18n::t;
use std::ops::Range;
use std::rc::Rc;

type OpenPlugin = Rc<dyn Fn(&SharedString, &mut Window, &mut App)>;

/// Fixed card height so rows can be virtualized: p_4 ×2 + header 24 +
/// 3 × gap_2 + description 40 + keyword row 24 + meta row 24.
const CARD_HEIGHT: Pixels = px(168.);
/// Card height plus the gap_3 row spacing baked into the virtual row size.
const ROW_HEIGHT: Pixels = px(180.);

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

fn keyword_chips(keywords: &[SharedString], cx: &App) -> impl IntoElement {
	h_flex().min_w_0().flex_wrap().gap_1().children(
		keywords
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
			.h(CARD_HEIGHT)
			.min_w_0()
			.overflow_hidden()
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
					.h(rems(1.5))
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
			.child(
				div()
					.h(rems(1.5))
					.overflow_hidden()
					.child(keyword_chips(item.keywords(), cx)),
			)
			.child(
				h_flex()
					.min_w_0()
					.items_center()
					.justify_between()
					.gap_2()
					.h(rems(1.5))
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
	doc: Doc,
}

impl Detail {
	pub fn new(item: Item) -> Self {
		Self {
			item,
			doc: Doc::Loading,
		}
	}

	pub fn with_doc(mut self, doc: Doc) -> Self {
		self.doc = doc;
		self
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

fn entry_row(title: SharedString, cx: &App) -> impl IntoElement {
	div()
		.w_full()
		.px_2()
		.py_1p5()
		.rounded(cx.theme().radius)
		.bg(cx.theme().group_box)
		.border_1()
		.border_color(cx.theme().border)
		.text_sm()
		.font_weight(FontWeight::MEDIUM)
		.child(title)
}

fn name_list(
	id: impl Into<ElementId>,
	label: String,
	names: &[SharedString],
	cx: &App,
) -> impl IntoElement {
	v_flex()
		.id(id)
		.w_full()
		.flex_shrink_0()
		.gap_3()
		.child(section_heading(label, names.len(), cx))
		.children(names.chunks(2).map(|pair| {
			h_flex()
				.w_full()
				.gap_3()
				.child(div().flex_1().child(entry_row(pair[0].clone(), cx)))
				.child(div().flex_1().children(
					pair.get(1).cloned().map(|name| entry_row(name, cx)),
				))
		}))
}

fn render_doc(doc: &Doc, cx: &App) -> AnyElement {
	match doc {
		Doc::Loading => v_flex()
			.w_full()
			.gap_2()
			.child(
				div()
					.text_sm()
					.text_color(cx.theme().muted_foreground)
					.child(SharedString::from(
						t!("marketplace.doc_loading").into_owned(),
					)),
			)
			.children((0..4).map(|line| {
				Skeleton::new().h_4().w(if line == 3 {
					rems(16.)
				} else {
					rems(40.)
				})
			}))
			.into_any_element(),
		Doc::Failed(error) => Alert::error("plugin-doc-failed", error.clone())
			.title(SharedString::from(
				t!("marketplace.doc_failed").into_owned(),
			))
			.into_any_element(),
		Doc::Ready {
			readme: Some(readme),
			..
		} => {
			// TextView fills `h_full()` unless `max_lines` is set. Inside the
			// page scroller that stretches it over the Skills/MCP block, and
			// the transparent markdown then shows the "MCP" heading on top of
			// the README. Cap height so it keeps its natural size instead.
			div()
				.id("plugin-readme-wrap")
				.w_full()
				.min_w_0()
				.flex_shrink_0()
				.child(
					TextView::markdown("plugin-readme", readme.clone())
						.max_lines(10_000),
				)
				.into_any_element()
		}
		Doc::Ready { readme: None, .. } => div()
			.text_sm()
			.text_color(cx.theme().muted_foreground)
			.child(SharedString::from(
				t!("marketplace.readme_missing").into_owned(),
			))
			.into_any_element(),
	}
}

impl RenderOnce for Detail {
	fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
		let item = self.item;
		// Header fields come from the plugin directory once the real
		// `plugin.json` arrives; until then the catalog summary stands in.
		let manifest: Option<&Manifest> = match &self.doc {
			Doc::Ready {
				manifest: Some(manifest),
				..
			} => Some(&**manifest),
			_ => None,
		};
		let name = manifest
			.map(|manifest| manifest.display_name())
			.unwrap_or(item.name())
			.clone();
		let version = manifest
			.map(|manifest| manifest.version())
			.unwrap_or(item.version())
			.clone();
		let license = manifest
			.map(|manifest| manifest.license())
			.unwrap_or(item.license())
			.clone();
		let description = manifest
			.map(|manifest| manifest.description())
			.unwrap_or(item.description())
			.clone();
		let author = manifest
			.map(|manifest| manifest.author())
			.unwrap_or(item.author())
			.clone();
		let homepage = manifest
			.map(|manifest| manifest.homepage())
			.unwrap_or(item.homepage())
			.clone();
		let keywords = manifest
			.map(|manifest| manifest.keywords())
			.unwrap_or(item.keywords());
		let logo = manifest
			.and_then(|manifest| manifest.logo_url())
			.or(item.logo_url())
			.cloned();
		let avatar = Avatar::new().name(name.clone());
		let avatar = match &logo {
			Some(url) => avatar.src(url.clone()),
			None => avatar,
		};
		// MCP names come from the real `mcp.json` once loaded. A missing file
		// falls back to the catalog list instead of wiping the section.
		let mcp: &[SharedString] = match &self.doc {
			Doc::Ready { mcp: Some(mcp), .. } => mcp,
			_ => item.mcp(),
		};
		let skills = item.skills();
		v_flex()
			.id("marketplace-plugin")
			.flex_1()
			.min_h_0()
			.min_w_0()
			.overflow_x_hidden()
			.overflow_y_scroll()
			.gap_6()
			.child(
				h_flex()
					.w_full()
					.items_start()
					.gap_3()
					.child(avatar.large())
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
											.child(name),
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
									.child(description),
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
											.href(homepage.to_string())
											.text_sm()
											.child(SharedString::from(
												t!("marketplace.view_source")
													.into_owned(),
											)),
									),
							)
							.child(keyword_chips(keywords, cx)),
					),
			)
			.when(!skills.is_empty(), |this| {
				this.child(name_list(
					"plugin-skills",
					t!("marketplace.skills").into(),
					skills,
					cx,
				))
			})
			.when(!mcp.is_empty(), |this| {
				this.child(name_list(
					"plugin-mcp",
					t!("marketplace.mcp").into(),
					mcp,
					cx,
				))
			})
			.child(render_doc(&self.doc, cx))
	}
}

/// Virtualized two-column card grid for the marketplace catalog.
///
/// Cards are grouped into fixed-height rows of two; the underlying
/// `v_virtual_list` only renders the rows intersecting the viewport.
pub struct GridState {
	catalog: Entity<Catalog>,
	category: Category,
	query: SharedString,
	on_open: Option<OpenPlugin>,
	items: Rc<Vec<Item>>,
	row_sizes: Rc<Vec<Size<Pixels>>>,
	scroll_handle: VirtualListScrollHandle,
	dirty: bool,
	_catalog: Subscription,
}

impl GridState {
	pub fn new(catalog: &Entity<Catalog>, cx: &mut Context<Self>) -> Self {
		let _catalog = cx.observe(catalog, |this, _, cx| {
			this.dirty = true;
			cx.notify();
		});
		Self {
			catalog: catalog.clone(),
			category: Category::All,
			query: SharedString::default(),
			on_open: None,
			items: Rc::new(Vec::new()),
			row_sizes: Rc::new(Vec::new()),
			scroll_handle: VirtualListScrollHandle::new(),
			dirty: true,
			_catalog,
		}
	}

	pub fn set_context(
		&mut self,
		category: Category,
		query: impl Into<SharedString>,
		on_open: impl Fn(&SharedString, &mut Window, &mut App) + 'static,
	) {
		let query = query.into();
		if self.category != category || self.query != query {
			self.category = category;
			self.query = query;
			self.dirty = true;
			self.scroll_handle.set_offset(point(px(0.), px(0.)));
		}
		self.on_open = Some(Rc::new(on_open));
	}

	fn sync_rows(&mut self, cx: &App) {
		if !self.dirty {
			return;
		}
		self.dirty = false;
		let items = self
			.catalog
			.read(cx)
			.visible(self.category, self.query.as_ref());
		self.row_sizes =
			Rc::new(vec![size(px(0.), ROW_HEIGHT); items.len().div_ceil(2)]);
		self.items = Rc::new(items);
	}
}

fn render_row(
	items: &[Item],
	row: usize,
	on_open: &Option<OpenPlugin>,
) -> AnyElement {
	let start = row * 2;
	h_flex()
		.w_full()
		.h(ROW_HEIGHT)
		.pb_3()
		.gap_3()
		.children((0..2).map(|column| {
			div()
				.flex_1()
				.min_w_0()
				.children(items.get(start + column).map(|item| Card {
					item: item.clone(),
					on_open: on_open.clone(),
				}))
		}))
		.into_any_element()
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

impl Render for GridState {
	fn render(
		&mut self,
		_: &mut Window,
		cx: &mut Context<Self>,
	) -> impl IntoElement {
		self.sync_rows(cx);
		let loading = self.catalog.read(cx).is_loading();
		let error = self.catalog.read(cx).error().cloned();
		let empty = if self.query.trim().is_empty() {
			t!("marketplace.empty")
		} else {
			t!("marketplace.empty_search")
		};
		let has_rows = !self.row_sizes.is_empty();
		let grid = cx.entity().clone();
		let row_sizes = self.row_sizes.clone();
		let items = self.items.clone();
		let on_open = self.on_open.clone();
		let scroll_handle = self.scroll_handle.clone();
		let scrollbar_handle = self.scroll_handle.clone();

		div()
			.id("marketplace-catalog")
			.flex_1()
			.min_h_0()
			.min_w_0()
			.relative()
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
			.when(has_rows, move |this| {
				this.child(
					v_virtual_list(
						grid,
						"marketplace-rows",
						row_sizes,
						move |_grid, rows: Range<usize>, _window, _cx| {
							rows.map(|row| render_row(&items, row, &on_open))
								.collect()
						},
					)
					.track_scroll(&scroll_handle)
					.flex_1()
					.min_h_0(),
				)
			})
			.when(has_rows, move |this| {
				this.child(Scrollbar::vertical(&scrollbar_handle))
			})
	}
}
