mod catalog;

pub use catalog::Category;

use catalog::{Item, catalog};
use gpui_kit::component::*;
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::*;
use phosphor_gpui::IconName as Phosphor;
use rust_i18n::t;

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
}

impl RenderOnce for Card {
	fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
		let item = self.item;
		v_flex()
			.id(item.id)
			.w_full()
			.min_w_0()
			.p_4()
			.gap_2()
			.rounded(cx.theme().radius)
			.bg(cx.theme().group_box)
			.border_1()
			.border_color(cx.theme().border)
			.child(
				div()
					.text_sm()
					.font_weight(FontWeight::MEDIUM)
					.truncate()
					.child(item.name),
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
pub struct Grid {
	category: Category,
}

impl Grid {
	pub fn new(category: Category) -> Self {
		Self { category }
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
				this.child(
					div()
						.w_full()
						.grid()
						.grid_cols(2)
						.gap_3()
						.children(items.into_iter().map(|item| Card { item })),
				)
			})
	}
}
