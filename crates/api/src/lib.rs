#[macro_use]
extern crate rocket;

use std::path::PathBuf;

use log::{debug, error, info, warn};
use rocket::{
	fairing::{Fairing, Info, Kind},
	Data, Request, Response,
};

pub mod dto;
pub mod editor_detection;
pub mod error;
pub mod extractors;
pub mod routes;
pub mod state;

pub struct ApiOptions {
	pub port: u16,
	pub app_data_dir: Option<PathBuf>,
}

impl ApiOptions {
	pub fn new(port: u16) -> Self {
		Self {
			port,
			app_data_dir: None,
		}
	}
}

fn default_app_data_dir() -> PathBuf {
	dirs::data_dir()
		.unwrap_or_else(std::env::temp_dir)
		.join("aghub")
}

struct ApiLogFairing;

#[rocket::async_trait]
impl Fairing for ApiLogFairing {
	fn info(&self) -> Info {
		Info {
			name: "aghub-api request logger",
			kind: Kind::Request | Kind::Response,
		}
	}

	async fn on_request(&self, request: &mut Request<'_>, _: &mut Data<'_>) {
		info!(
			"api request started: {} {}",
			request.method(),
			request.uri()
		);
	}

	async fn on_response<'r>(
		&self,
		request: &'r Request<'_>,
		response: &mut Response<'r>,
	) {
		let status = response.status();
		if status.class().is_server_error() {
			error!(
				"api request failed: {} {} -> {}",
				request.method(),
				request.uri(),
				status
			);
		} else if status.class().is_client_error() {
			warn!(
				"api request returned client error: {} {} -> {}",
				request.method(),
				request.uri(),
				status
			);
		} else {
			debug!(
				"api request completed: {} {} -> {}",
				request.method(),
				request.uri(),
				status
			);
		}
	}
}

fn build_rocket(
	config: rocket::Config,
	app_data_dir: PathBuf,
) -> rocket::Rocket<rocket::Build> {
	let cors = rocket_cors::CorsOptions {
		allowed_origins: rocket_cors::AllOrSome::All,
		allowed_methods: vec![
			rocket::http::Method::Get,
			rocket::http::Method::Post,
			rocket::http::Method::Put,
			rocket::http::Method::Delete,
			rocket::http::Method::Options,
		]
		.into_iter()
		.map(From::from)
		.collect(),
		allowed_headers: rocket_cors::AllowedHeaders::some(&[
			"Authorization",
			"Accept",
			"Content-Type",
		]),
		allow_credentials: true,
		..Default::default()
	}
	.to_cors()
	.unwrap();
	rocket::custom(config)
		.attach(ApiLogFairing)
		.attach(cors)
		.manage(crate::state::GitCloneSessions {
			sessions: std::sync::Mutex::new(std::collections::HashMap::new()),
		})
		.manage(crate::state::InferenceProviderState { app_data_dir })
		.mount(
			"/api/v1",
			routes![
				routes::preflight,
				routes::agents::list_agents,
				routes::agents::check_availability,
				routes::market::search_skill_market,
				routes::skills::list_all_agents_skills,
				routes::skills::list_skills,
				routes::skills::create_skill,
				routes::skills::import_skill,
				routes::skills::get_skill,
				routes::skills::update_skill,
				routes::skills::delete_skill,
				routes::skills::enable_skill,
				routes::skills::disable_skill,
				routes::skills::install_skill,
				routes::skills::transfer_skill_route,
				routes::skills::reconcile_skill_route,
				routes::mcps::list_all_agents_mcps,
				routes::mcps::list_mcps,
				routes::mcps::create_mcp,
				routes::mcps::get_mcp,
				routes::mcps::update_mcp,
				routes::mcps::delete_mcp,
				routes::mcps::enable_mcp,
				routes::mcps::disable_mcp,
				routes::mcps::transfer_mcp_route,
				routes::mcps::reconcile_mcp_route,
				routes::sub_agents::list_all_agents_sub_agents,
				routes::sub_agents::list_sub_agents,
				routes::sub_agents::get_sub_agent,
				routes::sub_agents::create_sub_agent,
				routes::sub_agents::update_sub_agent,
				routes::sub_agents::delete_sub_agent,
				routes::sub_agents::transfer_sub_agent_route,
				routes::sub_agents::reconcile_sub_agent_route,
				routes::integrations::list_code_editors,
				routes::integrations::open_with_editor,
				routes::integrations::get_preferences,
				routes::credentials::list_credentials,
				routes::credentials::create_credential,
				routes::credentials::delete_credential,
				routes::inference::list_inference_providers,
				routes::inference::list_inference_provider_presets,
				routes::inference::list_opencode_providers,
				routes::inference::list_codex_providers,
				routes::inference::get_codex_state,
				routes::inference::create_opencode_provider,
				routes::inference::create_codex_provider,
				routes::inference::update_opencode_provider,
				routes::inference::update_codex_provider,
				routes::inference::update_codex_active_profile,
				routes::inference::update_codex_profile_provider,
				routes::inference::sync_opencode_provider,
				routes::inference::sync_codex_provider,
				routes::inference::delete_opencode_provider,
				routes::inference::delete_codex_provider,
				routes::inference::get_inference_provider_password,
				routes::inference::create_inference_provider,
				routes::inference::update_inference_provider,
				routes::inference::get_claude_state,
				routes::inference::create_claude_provider,
				routes::inference::update_claude_provider,
				routes::inference::sync_claude_provider,
				routes::inference::delete_claude_provider,
				routes::inference::clear_claude_state,
				routes::inference::clear_codex_state,
				routes::inference::delete_inference_provider,
				routes::skills::open_skill_folder,
				routes::skills::edit_skill_folder,
				routes::skills::get_skill_content,
				routes::skills::get_skill_tree,
				routes::skills::get_global_skill_lock,
				routes::skills::get_project_skill_lock,
				routes::skills::delete_skill_by_path,
				routes::skills::git_scan_skills,
				routes::skills::git_install_skills,
				routes::skills::git_sync_skill,
				routes::plugins::list_plugins,
				routes::plugins::get_plugin_detail,
				routes::plugins::enable_plugin,
				routes::plugins::disable_plugin,
				routes::plugins::install_plugin,
				routes::plugins::uninstall_plugin,
				routes::plugins::reinstall_plugin,
				routes::plugins::update_plugin,
				routes::plugins::check_plugin_update,
				routes::plugins::open_plugin_folder,
				routes::plugins::open_plugin_skill_in_editor,
				routes::plugins::get_plugin_config,
				routes::plugins::update_plugin_config,
				routes::plugins::delete_plugin_config,
				routes::plugins::list_plugin_market,
				routes::plugins::update_marketplace,
			],
		)
		.register(
			"/",
			catchers![
				routes::catchers::not_found,
				routes::catchers::unprocessable_entity,
				routes::catchers::internal_error,
				routes::catchers::default_catcher,
			],
		)
}

pub async fn start(options: ApiOptions) -> Result<(), rocket::Error> {
	info!("starting aghub API server on 127.0.0.1:{}", options.port);
	let app_data_dir =
		options.app_data_dir.unwrap_or_else(default_app_data_dir);
	let config = rocket::Config {
		port: options.port,
		address: std::net::IpAddr::V4(std::net::Ipv4Addr::LOCALHOST),
		log_level: rocket::config::LogLevel::Normal,
		..rocket::Config::default()
	};
	build_rocket(config, app_data_dir)
		.launch()
		.await
		.inspect(|_rocket| {
			info!("aghub API server stopped cleanly");
		})
		.map(|_| ())
		.map_err(|error| {
			error!("aghub API server exited with error: {error}");
			error
		})
}

#[cfg(test)]
mod tests {
	use super::{build_rocket, default_app_data_dir};
	use rocket::http::{Header, Status};
	use rocket::local::blocking::Client;

	#[test]
	fn plugin_preflight_routes_return_cors_response() {
		let client = Client::tracked(build_rocket(
			rocket::Config::default(),
			default_app_data_dir(),
		))
		.expect("client");

		for path in [
			"/api/v1/plugins/check-update",
			"/api/v1/plugins/reinstall",
			"/api/v1/plugins/uninstall",
		] {
			let response = client
				.req(rocket::http::Method::Options, path)
				.header(Header::new("Origin", "http://localhost:1420"))
				.header(Header::new("Access-Control-Request-Method", "POST"))
				.header(Header::new(
					"Access-Control-Request-Headers",
					"content-type",
				))
				.dispatch();

			assert_eq!(response.status(), Status::NoContent);
			assert_eq!(
				response.headers().get_one("Access-Control-Allow-Origin"),
				Some("http://localhost:1420"),
			);
			assert_eq!(
				response.headers().get_one("Access-Control-Allow-Headers"),
				Some("content-type"),
			);
		}
	}
}
