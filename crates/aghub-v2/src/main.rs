mod fonts;
mod http;
mod i18n;
mod installed;
mod marketplace;
mod theme;
mod workspace;

use aghub_v2::db;

use gpui_kit::component::*;
use gpui_kit::*;
use workspace::Workspace;

rust_i18n::i18n!("locales", fallback = "en");

/// Design canvas for this app: 1.25× the previous 882×600 window.
const DESIGN_WINDOW_SIZE: gpui_kit::Size<Pixels> = size(px(1103.), px(750.));

fn main() {
	http::register_backend();
	let app = gpui_kit::application()
		.with_http_client(http::client())
		.with_assets(
			phosphor_gpui::Assets.with_fallback(gpui_kit::assets::Assets),
		);

	app.run(move |cx| {
		// This must be called before using any GPUI Component features.
		gpui_kit::init(cx);
		fonts::init(cx);
		theme::init(cx);
		i18n::init();
		db::init(cx);

		let options = WindowOptions {
			window_bounds: Some(WindowBounds::centered(DESIGN_WINDOW_SIZE, cx)),
			..TitleBar::window_options()
		};

		cx.spawn(async move |cx| {
			if let Err(error) = db::open(cx).await {
				eprintln!("{error:#}");
				cx.update(|cx| cx.quit());
				return;
			}

			cx.open_window(options, |window, cx| {
				let view = cx.new(|cx| Workspace::new(window, cx));
				// This first level on the window, should be a Root.
				cx.new(|cx| Root::new(view, window, cx))
			})
			.expect("Failed to open window");
		})
		.detach();
	});
}
