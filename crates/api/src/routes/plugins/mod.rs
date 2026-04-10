mod config;
mod detail;
mod lifecycle;
mod market;
mod shared;

pub use self::config::{
	delete_plugin_config, get_plugin_config, update_plugin_config,
};
pub use self::detail::get_plugin_detail;
pub use self::lifecycle::{
	check_plugin_update, disable_plugin, enable_plugin, install_plugin,
	list_plugins, open_plugin_folder, reinstall_plugin, uninstall_plugin,
	update_plugin,
};
pub use self::market::{list_plugin_market, update_marketplace};
