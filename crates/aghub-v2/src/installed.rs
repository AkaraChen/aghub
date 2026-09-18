use aghub::plugin::Plugin;
use gpui_kit::component::*;
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::*;
use rust_i18n::t;
use std::rc::Rc;

use crate::subscribe;

type OpenPlugin = Rc<dyn Fn(&SharedString, &mut Window, &mut App)>;

#[derive(IntoElement)]
struct Card {
	plugin: Plugin,
	on_open: Option<OpenPlugin>,
}

impl RenderOnce for Card {
	fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
		let id: SharedString = self.plugin.id.clone().into();
		let openable = subscribe::item(&id).is_some();
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
			.when(openable, |this| {
				this.hover(|this| this.bg(cx.theme().muted))
			})
			.when(openable, |this| {
				this.when_some(self.on_open, |this, on_open| {
					this.on_click(move |_, window, cx| {
						on_open(&id, window, cx);
					})
				})
			})
			.child(
				h_flex()
					.min_w_0()
					.gap_1()
					.child(subscribe::cursor_org_icon(0.875))
					.child(
						div()
							.min_w_0()
							.flex_1()
							.text_sm()
							.font_weight(FontWeight::MEDIUM)
							.truncate()
							.child(self.plugin.name),
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
					.child(self.plugin.description),
			)
	}
}

#[derive(IntoElement)]
pub struct Grid {
	plugins: Vec<Plugin>,
	on_open: Option<OpenPlugin>,
}

impl Grid {
	pub fn new(plugins: Vec<Plugin>) -> Self {
		Self {
			plugins,
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
		div()
			.id("installed-plugins")
			.flex_1()
			.min_h_0()
			.min_w_0()
			.overflow_y_scroll()
			.when(self.plugins.is_empty(), |this| {
				this.child(
					div()
						.text_sm()
						.text_color(cx.theme().muted_foreground)
						.child(SharedString::from(
							t!("plugins.empty").into_owned(),
						)),
				)
			})
			.when(!self.plugins.is_empty(), |this| {
				this.child(div().w_full().grid().grid_cols(2).gap_3().children(
					self.plugins.into_iter().map(|plugin| Card {
						plugin,
						on_open: self.on_open.clone(),
					}),
				))
			})
	}
}
