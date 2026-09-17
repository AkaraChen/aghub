mod theme;
mod workspace;

use gpui_kit::component::*;
use gpui_kit::*;
use workspace::Workspace;

/// Design canvas for this app: 60% × 65% of the 15" Air logical
/// display (1470×956 @2x). Layouts should target this size.
const DESIGN_WINDOW_SIZE: gpui_kit::Size<Pixels> = size(px(882.), px(600.));

fn main() {
	let app = gpui_kit::application().with_assets(gpui_kit::assets::Assets);

	app.run(move |cx| {
		// This must be called before using any GPUI Component features.
		gpui_kit::init(cx);
		theme::init(cx);

		let options = WindowOptions {
			window_bounds: Some(WindowBounds::centered(DESIGN_WINDOW_SIZE, cx)),
			..Default::default()
		};

		cx.spawn(async move |cx| {
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
