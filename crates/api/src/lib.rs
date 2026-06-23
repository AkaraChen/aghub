#[macro_use]
extern crate rocket;

use std::path::PathBuf;

use log::{debug, error, info, warn};
use rocket::{
	fairing::{Fairing, Info, Kind},
	Data, Request, Response,
};

pub mod auth;
pub mod dto;
pub mod editor_detection;
pub mod error;
pub mod extractors;
pub mod routes;
pub mod state;

#[cfg(windows)]
pub(crate) const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub struct ApiOptions {
	pub port: u16,
	pub app_data_dir: Option<PathBuf>,
	pub auth_token: Option<String>,
	pub allowed_origins: Vec<String>,
	pub allowed_origin_regexes: Vec<String>,
}

impl ApiOptions {
	pub fn new(port: u16) -> Self {
		Self {
			port,
			app_data_dir: None,
			auth_token: None,
			allowed_origins: default_allowed_origins(),
			allowed_origin_regexes: default_allowed_origin_regexes(),
		}
	}

	fn resolve(self) -> ResolvedApiOptions {
		let env_token = std::env::var("AGHUB_API_TOKEN")
			.ok()
			.filter(|value| !value.trim().is_empty());
		let configured_token = self
			.auth_token
			.filter(|value| !value.trim().is_empty())
			.or(env_token);
		let (auth_token, token_was_generated) =
			if let Some(token) = configured_token {
				(token, false)
			} else {
				(crate::auth::generate_auth_token(), true)
			};
		ResolvedApiOptions {
			port: self.port,
			app_data_dir: self
				.app_data_dir
				.unwrap_or_else(default_app_data_dir),
			auth_token,
			token_was_generated,
			allowed_origins: self.allowed_origins,
			allowed_origin_regexes: self.allowed_origin_regexes,
		}
	}
}

fn default_app_data_dir() -> PathBuf {
	dirs::data_dir()
		.unwrap_or_else(std::env::temp_dir)
		.join("aghub")
}

fn default_allowed_origins() -> Vec<String> {
	vec![
		"http://localhost:1420".to_string(),
		"http://tauri.localhost".to_string(),
		"https://tauri.localhost".to_string(),
	]
}

fn default_allowed_origin_regexes() -> Vec<String> {
	vec![r"^tauri://localhost$".to_string()]
}

struct ResolvedApiOptions {
	port: u16,
	app_data_dir: PathBuf,
	auth_token: String,
	token_was_generated: bool,
	allowed_origins: Vec<String>,
	allowed_origin_regexes: Vec<String>,
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
	options: ResolvedApiOptions,
) -> rocket::Rocket<rocket::Build> {
	let allowed_origins = rocket_cors::AllowedOrigins::some(
		&options.allowed_origins,
		&options.allowed_origin_regexes,
	);
	let cors = rocket_cors::CorsOptions {
		allowed_origins,
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
			"X-AGHUB-API-Token",
			"Accept",
			"Content-Type",
		]),
		allow_credentials: false,
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
		.manage(crate::state::InferenceProviderState {
			app_data_dir: options.app_data_dir,
		})
		.manage(crate::auth::ApiAuthState {
			token: options.auth_token,
		})
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
				routes::hooks::list_all_agents_hooks,
				routes::hooks::list_hooks,
				routes::hooks::get_hook,
				routes::hooks::create_hook,
				routes::hooks::update_hook,
				routes::hooks::delete_hook,
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
				routes::plugins::update_plugin,
				routes::plugins::open_plugin_folder,
				routes::plugins::open_plugin_skill_in_editor,
				routes::plugins::get_plugin_config,
				routes::plugins::update_plugin_config,
				routes::plugins::delete_plugin_config,
				routes::plugins::list_plugin_market,
				routes::plugins::update_marketplace,
				routes::plugins::list_marketplaces,
				routes::plugins::add_marketplace,
				routes::plugins::remove_marketplace,
				routes::plugins::update_marketplace_one,
				routes::plugins::cli_status,
				routes::plugins::prune_plugins,
				routes::plugins::validate_plugin,
			],
		)
		.register(
			"/",
			catchers![
				routes::catchers::unauthorized,
				routes::catchers::forbidden,
				routes::catchers::not_found,
				routes::catchers::unprocessable_entity,
				routes::catchers::internal_error,
				routes::catchers::default_catcher,
			],
		)
}

pub async fn start(options: ApiOptions) -> Result<(), rocket::Error> {
	let resolved = options.resolve();
	if resolved.token_was_generated {
		eprintln!("AGHUB_API_TOKEN={}", resolved.auth_token);
	}
	info!("starting aghub API server on 127.0.0.1:{}", resolved.port);
	let config = rocket::Config {
		port: resolved.port,
		address: std::net::IpAddr::V4(std::net::Ipv4Addr::LOCALHOST),
		log_level: rocket::config::LogLevel::Normal,
		..rocket::Config::default()
	};
	build_rocket(config, resolved)
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
	use super::{build_rocket, default_app_data_dir, ApiOptions};
	use rocket::http::{ContentType, Header, Status};
	use rocket::local::blocking::{Client, LocalResponse};
	use serde_json::{json, Value};
	use std::ffi::OsString;
	use std::path::Path;
	use std::sync::{Mutex, MutexGuard, OnceLock};

	struct PathEnvGuard {
		_lock: MutexGuard<'static, ()>,
		previous: Option<OsString>,
	}

	impl Drop for PathEnvGuard {
		fn drop(&mut self) {
			match &self.previous {
				Some(path) => std::env::set_var("PATH", path),
				None => std::env::remove_var("PATH"),
			}
		}
	}

	fn env_lock() -> &'static Mutex<()> {
		static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
		LOCK.get_or_init(|| Mutex::new(()))
	}

	fn hide_cli_path() -> PathEnvGuard {
		let lock = env_lock().lock().expect("env lock");
		let previous = std::env::var_os("PATH");
		std::env::set_var("PATH", "");
		PathEnvGuard {
			_lock: lock,
			previous,
		}
	}

	const TEST_AUTH_TOKEN: &str = "test-auth-token";

	fn test_client(app_data_dir: &Path) -> Client {
		let mut options = ApiOptions::new(0);
		options.app_data_dir = Some(app_data_dir.to_path_buf());
		options.auth_token = Some(TEST_AUTH_TOKEN.to_string());
		Client::tracked(build_rocket(
			rocket::Config::default(),
			options.resolve(),
		))
		.expect("client")
	}

	fn auth_header() -> Header<'static> {
		Header::new(
			crate::auth::AUTHORIZATION_HEADER,
			format!("Bearer {TEST_AUTH_TOKEN}"),
		)
	}

	fn project_query(project_root: &Path) -> String {
		let mut serializer =
			url::form_urlencoded::Serializer::new(String::new());
		serializer.append_pair("scope", "project");
		serializer.append_pair("project_root", &project_root.to_string_lossy());
		serializer.finish()
	}

	fn skill_content_query(skill_file: &Path, project_root: &Path) -> String {
		let mut serializer =
			url::form_urlencoded::Serializer::new(String::new());
		serializer.append_pair("path", &skill_file.to_string_lossy());
		serializer.append_pair("scope", "project");
		serializer.append_pair("project_root", &project_root.to_string_lossy());
		serializer.finish()
	}

	fn response_json(response: LocalResponse<'_>) -> Value {
		let body = response.into_string().expect("response body");
		serde_json::from_str(&body).expect("json response")
	}

	fn assert_json_error(
		response: LocalResponse<'_>,
		status: Status,
		code: &str,
	) {
		assert_eq!(response.status(), status);
		let body = response_json(response);
		assert_eq!(body["code"], code);
	}

	fn post_json<'c>(
		client: &'c Client,
		uri: &'c str,
		body: Value,
	) -> LocalResponse<'c> {
		client
			.post(uri)
			.header(auth_header())
			.header(ContentType::JSON)
			.body(body.to_string())
			.dispatch()
	}

	fn put_json<'c>(
		client: &'c Client,
		uri: &'c str,
		body: Value,
	) -> LocalResponse<'c> {
		client
			.put(uri)
			.header(auth_header())
			.header(ContentType::JSON)
			.body(body.to_string())
			.dispatch()
	}

	fn get_auth<'c>(client: &'c Client, uri: &'c str) -> LocalResponse<'c> {
		client.get(uri).header(auth_header()).dispatch()
	}

	fn delete_auth<'c>(client: &'c Client, uri: &'c str) -> LocalResponse<'c> {
		client.delete(uri).header(auth_header()).dispatch()
	}

	fn write_import_skill(dir: &Path, name: &str, body: &str) {
		std::fs::create_dir_all(dir).expect("skill dir");
		std::fs::write(
			dir.join("SKILL.md"),
			format!(
				"---\nname: {name}\ndescription: imported skill\n---\n\n{body}\n"
			),
		)
		.expect("skill file");
		std::fs::create_dir_all(dir.join("scripts")).expect("scripts dir");
		std::fs::create_dir_all(dir.join("references"))
			.expect("references dir");
		std::fs::create_dir_all(dir.join("assets")).expect("assets dir");
		std::fs::write(dir.join("scripts/setup.sh"), "echo setup")
			.expect("script");
		std::fs::write(dir.join("references/guide.md"), "# Guide")
			.expect("guide");
		std::fs::write(dir.join("assets/logo.txt"), "logo").expect("asset");
	}

	#[test]
	fn auth_options_generate_distinct_tokens() {
		let first = crate::auth::generate_auth_token();
		let second = crate::auth::generate_auth_token();

		assert_ne!(first, second);
		assert!(first.len() >= 32);
	}

	#[test]
	fn auth_missing_token_returns_unauthorized_json() {
		let app_data_dir = tempfile::tempdir().expect("app data dir");
		let client = test_client(app_data_dir.path());
		let response = client.get("/api/v1/agents").dispatch();

		assert_json_error(response, Status::Unauthorized, "UNAUTHORIZED");
	}

	#[test]
	fn auth_wrong_token_returns_forbidden_json() {
		let app_data_dir = tempfile::tempdir().expect("app data dir");
		let client = test_client(app_data_dir.path());
		let response = client
			.get("/api/v1/agents")
			.header(Header::new(
				crate::auth::AUTHORIZATION_HEADER,
				"Bearer wrong-token",
			))
			.dispatch();

		assert_json_error(response, Status::Forbidden, "FORBIDDEN");
	}

	#[test]
	fn auth_correct_token_allows_api_access() {
		let app_data_dir = tempfile::tempdir().expect("app data dir");
		let client = test_client(app_data_dir.path());
		let response = get_auth(&client, "/api/v1/agents");

		assert_eq!(response.status(), Status::Ok);
	}

	#[test]
	fn plugin_install_rejects_remote_browser_origin() {
		let client = test_client(&default_app_data_dir());

		let response = client
			.post("/api/v1/plugins/install")
			.header(auth_header())
			.header(Header::new("Origin", "https://evil.example"))
			.header(Header::new("Content-Type", "application/json"))
			.body(
				r#"{"plugin_id":"p@https://github.com/a/b","scope":"global"}"#,
			)
			.dispatch();

		assert_eq!(response.status(), Status::Forbidden);
	}

	#[test]
	fn plugin_preflight_routes_return_cors_response() {
		let client = test_client(&default_app_data_dir());

		let path = "/api/v1/plugins/uninstall";
		let response = client
			.req(rocket::http::Method::Options, path)
			.header(Header::new("Origin", "http://localhost:1420"))
			.header(Header::new("Access-Control-Request-Method", "POST"))
			.header(Header::new(
				"Access-Control-Request-Headers",
				"authorization,content-type",
			))
			.dispatch();

		assert_eq!(response.status(), Status::NoContent);
		assert_eq!(
			response.headers().get_one("Access-Control-Allow-Origin"),
			Some("http://localhost:1420"),
		);
		let allow_headers = response
			.headers()
			.get_one("Access-Control-Allow-Headers")
			.expect("allow headers");
		assert!(allow_headers.contains("authorization"));
		assert!(allow_headers.contains("content-type"));
		assert_eq!(
			response
				.headers()
				.get_one("Access-Control-Allow-Credentials"),
			None,
		);
	}

	#[test]
	fn cors_disallowed_origin_does_not_grant_access() {
		let client = test_client(&default_app_data_dir());

		let response = client
			.req(rocket::http::Method::Options, "/api/v1/plugins/uninstall")
			.header(Header::new("Origin", "https://example.com"))
			.header(Header::new("Access-Control-Request-Method", "POST"))
			.header(Header::new(
				"Access-Control-Request-Headers",
				"authorization,content-type",
			))
			.dispatch();

		assert_eq!(
			response.headers().get_one("Access-Control-Allow-Origin"),
			None,
		);
	}

	#[test]
	fn route_skill_create_update_delete_persists_project_files() {
		let _path_guard = hide_cli_path();
		let app_data_dir = tempfile::tempdir().expect("app data dir");
		let project_dir = tempfile::tempdir().expect("project dir");
		let client = test_client(app_data_dir.path());
		let query = project_query(project_dir.path());
		let collection_uri = format!("/api/v1/agents/claude/skills?{query}");
		let item_uri =
			format!("/api/v1/agents/claude/skills/route-skill?{query}");
		let missing_auth = client
			.post(&collection_uri)
			.header(ContentType::JSON)
			.body(
				json!({
					"name": "route-skill",
					"description": "created",
					"content": "# Body",
					"tools": [],
				})
				.to_string(),
			)
			.dispatch();
		assert_json_error(missing_auth, Status::Unauthorized, "UNAUTHORIZED");

		let response = post_json(
			&client,
			&collection_uri,
			json!({
				"name": "route-skill",
				"description": "created",
				"author": null,
				"version": null,
				"content": "# Body",
				"tools": [],
			}),
		);
		assert_eq!(response.status(), Status::Created);
		let body = response_json(response);
		assert_eq!(body["name"], "route-skill");

		let response = get_auth(&client, &item_uri);
		assert_eq!(response.status(), Status::Ok);
		let body = response_json(response);
		assert_eq!(body["description"], "created");

		let response = put_json(
			&client,
			&item_uri,
			json!({
				"description": "updated",
				"content": "# Updated",
			}),
		);
		assert_eq!(response.status(), Status::Ok);

		let skill_file = project_dir
			.path()
			.join(".claude/skills/route-skill/SKILL.md");
		let persisted =
			std::fs::read_to_string(&skill_file).expect("persisted skill");
		assert!(persisted.contains("route-skill"));
		assert!(persisted.contains("updated"));
		assert!(persisted.contains("# Updated"));

		let response = delete_auth(&client, &item_uri);
		assert_eq!(response.status(), Status::NoContent);
		assert!(!skill_file.exists(), "deleted skill file should be removed");

		let response = get_auth(&client, &collection_uri);
		assert_eq!(response.status(), Status::Ok);
		let body = response_json(response);
		assert_eq!(body.as_array().expect("skill list").len(), 0);
	}

	#[test]
	fn route_skill_content_requires_auth() {
		let app_data_dir = tempfile::tempdir().expect("app data dir");
		let project_dir = tempfile::tempdir().expect("project dir");
		let skill_file = project_dir
			.path()
			.join(".claude/skills/route-skill/SKILL.md");
		std::fs::create_dir_all(skill_file.parent().expect("skill parent"))
			.expect("skill dir");
		std::fs::write(
			&skill_file,
			"---\nname: route-skill\ndescription: route skill\n---\n\n# Body\n",
		)
		.expect("skill file");

		let client = test_client(app_data_dir.path());
		let query = skill_content_query(&skill_file, project_dir.path());
		let uri = format!("/api/v1/skills/content?{query}");
		let response = client.get(&uri).dispatch();
		assert_json_error(response, Status::Unauthorized, "UNAUTHORIZED");

		let response = get_auth(&client, &uri);
		assert_eq!(response.status(), Status::Ok);
		assert_eq!(response_json(response), json!("# Body"));
	}

	#[test]
	fn import_skill_route_preserves_body_and_resources() {
		let app_data_dir = tempfile::tempdir().expect("app data dir");
		let project_dir = tempfile::tempdir().expect("project dir");
		let source_dir = tempfile::tempdir().expect("source dir");
		let skill_dir = source_dir.path().join("imported-route");
		write_import_skill(
			&skill_dir,
			"imported-route",
			"# Route imported instructions",
		);
		let client = test_client(app_data_dir.path());
		let query = project_query(project_dir.path());
		let uri = format!("/api/v1/agents/claude/skills/import?{query}");

		let response = post_json(
			&client,
			&uri,
			json!({ "path": skill_dir.display().to_string() }),
		);
		assert_eq!(response.status(), Status::Ok);
		let body = response_json(response);
		assert_eq!(body["name"], "imported-route");

		let target_dir =
			project_dir.path().join(".claude/skills/imported-route");
		let content =
			std::fs::read_to_string(target_dir.join("SKILL.md")).unwrap();
		assert!(content.contains("# Route imported instructions"));
		assert!(target_dir.join("scripts/setup.sh").exists());
		assert!(target_dir.join("references/guide.md").exists());
		assert!(target_dir.join("assets/logo.txt").exists());
	}

	#[test]
	fn route_mcp_create_update_delete_persists_project_config() {
		let app_data_dir = tempfile::tempdir().expect("app data dir");
		let project_dir = tempfile::tempdir().expect("project dir");
		let client = test_client(app_data_dir.path());
		let query = project_query(project_dir.path());
		let collection_uri = format!("/api/v1/agents/claude/mcps?{query}");
		let item_uri = format!("/api/v1/agents/claude/mcps/route-mcp?{query}");

		let response = post_json(
			&client,
			&collection_uri,
			json!({
				"name": "route-mcp",
				"transport": {
					"type": "stdio",
					"command": "node",
					"args": ["server.js"],
				},
				"timeout": null,
			}),
		);
		assert_eq!(response.status(), Status::Created);
		let body = response_json(response);
		assert_eq!(body["name"], "route-mcp");
		assert_eq!(body["transport"]["command"], "node");

		let response = get_auth(&client, &item_uri);
		assert_eq!(response.status(), Status::Ok);
		let body = response_json(response);
		assert_eq!(body["transport"]["args"], json!(["server.js"]));

		let response = put_json(
			&client,
			&item_uri,
			json!({
				"transport": {
					"type": "stdio",
					"command": "node",
					"args": ["updated.js"],
				},
			}),
		);
		assert_eq!(response.status(), Status::Ok);
		let body = response_json(response);
		assert_eq!(body["transport"]["args"], json!(["updated.js"]));

		let config_path = project_dir.path().join(".mcp.json");
		assert!(config_path.exists(), "mcp config should be persisted");
		let persisted =
			std::fs::read_to_string(&config_path).expect("mcp config");
		assert!(persisted.contains("route-mcp"));
		assert!(persisted.contains("updated.js"));

		let response = delete_auth(&client, &item_uri);
		assert_eq!(response.status(), Status::NoContent);
		if config_path.exists() {
			let persisted =
				std::fs::read_to_string(config_path).expect("mcp config");
			assert!(!persisted.contains("route-mcp"));
		}
	}

	#[test]
	fn route_sub_agent_create_update_delete_persists_project_file() {
		let app_data_dir = tempfile::tempdir().expect("app data dir");
		let project_dir = tempfile::tempdir().expect("project dir");
		let client = test_client(app_data_dir.path());
		let query = project_query(project_dir.path());
		let collection_uri =
			format!("/api/v1/agents/claude/sub-agents?{query}");
		let item_uri =
			format!("/api/v1/agents/claude/sub-agents/route-agent?{query}");

		let response = post_json(
			&client,
			&collection_uri,
			json!({
				"name": "route-agent",
				"description": "created",
				"instruction": "Create useful output.",
			}),
		);
		assert_eq!(response.status(), Status::Created);
		let body = response_json(response);
		assert_eq!(body["name"], "route-agent");

		let response = get_auth(&client, &item_uri);
		assert_eq!(response.status(), Status::Ok);
		let body = response_json(response);
		assert_eq!(body["description"], "created");

		let response = put_json(
			&client,
			&item_uri,
			json!({
				"description": "updated",
				"instruction": "Use updated instructions.",
			}),
		);
		assert_eq!(response.status(), Status::Ok);
		let body = response_json(response);
		assert_eq!(body["instruction"], "Use updated instructions.");

		let sub_agent_file =
			project_dir.path().join(".claude/agents/route-agent.md");
		let persisted = std::fs::read_to_string(&sub_agent_file)
			.expect("persisted sub-agent");
		assert!(persisted.contains("updated"));
		assert!(persisted.contains("Use updated instructions."));

		let response = delete_auth(&client, &item_uri);
		assert_eq!(response.status(), Status::NoContent);
		assert!(
			!sub_agent_file.exists(),
			"deleted sub-agent file should be removed"
		);

		let response = get_auth(&client, &collection_uri);
		assert_eq!(response.status(), Status::Ok);
		let body = response_json(response);
		assert_eq!(body.as_array().expect("sub-agent list").len(), 0);
	}

	#[test]
	fn route_invalid_scope_returns_bad_request_json() {
		let app_data_dir = tempfile::tempdir().expect("app data dir");
		let client = test_client(app_data_dir.path());
		let response = client
			.get("/api/v1/agents/claude/skills?scope=sideways")
			.header(auth_header())
			.dispatch();

		assert_json_error(response, Status::BadRequest, "INVALID_PARAM");
		let response = client
			.get("/api/v1/agents/claude/skills?scope=sideways")
			.header(auth_header())
			.dispatch();
		let body = response_json(response);
		let error = body["error"].as_str().expect("error message");
		assert!(error.contains("global"));
		assert!(error.contains("project"));
		assert!(error.contains("all"));
	}
}
