mod catalog;

pub use catalog::{Category, Item, item};

use catalog::catalog;
use gpui_kit::component::link::Link;
use gpui_kit::component::*;
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::*;
use phosphor_gpui::IconName as Phosphor;
use rust_i18n::t;
use std::rc::Rc;
use std::sync::{Arc, OnceLock};

type OpenPlugin = Rc<dyn Fn(&SharedString, &mut Window, &mut App)>;

const CURSOR_ORG_PNG: &[u8] = include_bytes!("../../assets/cursor-org.png");

fn cursor_org_icon(size: f32) -> impl IntoElement {
	static IMAGE: OnceLock<Arc<Image>> = OnceLock::new();
	let image = IMAGE
		.get_or_init(|| {
			Arc::new(Image::from_bytes(
				ImageFormat::Png,
				CURSOR_ORG_PNG.to_vec(),
			))
		})
		.clone();
	img(image)
		.size(rems(size))
		.flex_shrink_0()
		.rounded_sm()
		.overflow_hidden()
}

impl Category {
	pub fn title(self) -> String {
		match self {
			Self::All => t!("subscribe.category.all").into(),
			Self::Utilities => t!("subscribe.category.utilities").into(),
			Self::DeveloperTools => {
				t!("subscribe.category.developer_tools").into()
			}
			Self::Productivity => t!("subscribe.category.productivity").into(),
			Self::Integrations => t!("subscribe.category.integrations").into(),
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

#[derive(IntoElement)]
struct Card {
	item: Item,
	on_open: Option<OpenPlugin>,
}

impl RenderOnce for Card {
	fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
		let item = self.item;
		let id = item.id.clone();
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
				this.on_click(move |_, window, cx| {
					on_open(&id, window, cx);
				})
			})
			.child(
				h_flex()
					.min_w_0()
					.gap_1()
					.child(cursor_org_icon(0.875))
					.child(
						div()
							.min_w_0()
							.flex_1()
							.text_sm()
							.font_weight(FontWeight::MEDIUM)
							.truncate()
							.child(item.name),
					),
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
					.child(item.description),
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
	href: String,
	title: SharedString,
	detail: Option<SharedString>,
	cx: &App,
) -> impl IntoElement {
	v_flex()
		.min_w_0()
		.gap_1()
		.child(
			Link::new(id)
				.href(href)
				.text_sm()
				.font_weight(FontWeight::MEDIUM)
				.child(title),
		)
		.when_some(detail, |this, detail| {
			this.child(
				div()
					.min_w_0()
					.text_sm()
					.line_height(rems(1.25))
					.text_color(cx.theme().muted_foreground)
					.text_ellipsis()
					.line_clamp(2)
					.child(detail),
			)
		})
}

impl RenderOnce for Detail {
	fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
		let item = self.item;
		let skills = item.skills().to_vec();
		let mcp = item.mcp().to_vec();

		div()
			.id("subscribe-plugin")
			.flex_1()
			.min_h_0()
			.min_w_0()
			.overflow_y_scroll()
			.child(
				v_flex()
					.w_full()
					.gap_6()
					.child(
						h_flex()
							.w_full()
							.items_start()
							.gap_3()
							.child(cursor_org_icon(2.5))
							.child(
								v_flex()
									.min_w_0()
									.flex_1()
									.gap_2()
									.child(
										div()
											.text_lg()
											.font_weight(FontWeight::MEDIUM)
											.child(item.name().clone()),
									)
									.child(
										div()
											.text_sm()
											.line_height(rems(1.25))
											.text_color(
												cx.theme().muted_foreground,
											)
											.child(item.description().clone()),
									)
									.child(
										h_flex()
											.gap_3()
											.child(
												div()
													.text_sm()
													.text_color(
														cx.theme()
															.muted_foreground,
													)
													.child(SharedString::from(
														t!(
															"subscribe.created_by",
															name = "Cursor"
														)
														.into_owned(),
													)),
											)
											.child(
												Link::new("plugin-source")
													.href(item.source_url())
													.text_sm()
													.child(SharedString::from(
														t!(
															"subscribe.view_source"
														)
														.into_owned(),
													)),
											),
									),
							),
					)
					.when(!skills.is_empty(), |this| {
						this.child(
							v_flex()
								.w_full()
								.gap_3()
								.child(section_heading(
									t!("subscribe.skills").into(),
									skills.len(),
									cx,
								))
								.children(skills.into_iter().map(|skill| {
									let description =
										skill.description().clone();
									entry_row(
										format!(
											"skill-{}",
											skill.name().as_ref()
										),
										skill.source_url(),
										skill.name().clone(),
										if description.is_empty() {
											None
										} else {
											Some(description)
										},
										cx,
									)
								})),
						)
					})
					.when(!mcp.is_empty(), |this| {
						this.child(
							v_flex()
								.w_full()
								.gap_3()
								.child(section_heading(
									t!("subscribe.mcp").into(),
									mcp.len(),
									cx,
								))
								.children(mcp.into_iter().map(|server| {
									entry_row(
										format!(
											"mcp-{}",
											server.name().as_ref()
										),
										server.source_url(),
										server.name().clone(),
										server.url().cloned(),
										cx,
									)
								})),
						)
					}),
			)
	}
}

#[derive(IntoElement)]
pub struct Grid {
	category: Category,
	on_open: Option<OpenPlugin>,
}

impl Grid {
	pub fn new(category: Category) -> Self {
		Self {
			category,
			on_open: None,
		}
	}

	pub fn on_open(
		mut self,
		on_open: impl Fn(&SharedString, &mut Window, &mut App) + 'static,
	) -> Self {
		self.on_open = Some(Rc::new(on_open));
		self
	}
}

impl RenderOnce for Grid {
	fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
		let items: Vec<Item> = catalog()
			.iter()
			.filter(|item| self.category.contains(item))
			.cloned()
			.collect();

		div()
			.id("subscribe-catalog")
			.flex_1()
			.min_h_0()
			.min_w_0()
			.overflow_y_scroll()
			.when(items.is_empty(), |this| {
				this.child(
					div()
						.text_sm()
						.text_color(cx.theme().muted_foreground)
						.child(SharedString::from(
							t!("subscribe.empty").into_owned(),
						)),
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
