//! Live contract smoke test against a real CLIProxyAPI release.
//!
//! Ignored by default: it downloads the pinned release from GitHub (or
//! `AGHUB_CLIPROXY_DOWNLOAD_BASE`), boots it with a generated config in a
//! temp dir, and exercises the management-API subset the client wraps.
//! Run before bumping `provision::PINNED_VERSION`:
//!
//! ```sh
//! cargo test -p aghub-cliproxy --test live_smoke -- --ignored --nocapture
//! ```

use aghub_cliproxy::dto::{
	GatewayCompatModelDto, GatewayCompatProviderDto, GatewayInstanceKind,
	GatewayInstanceStatus, GatewayOauthProvider, GatewaySettingValue,
	GatewayUpstreamProvider,
};
use aghub_cliproxy::lifecycle::GatewayRuntime;
use aghub_cliproxy::store::GatewayInstanceRecord;
use aghub_cliproxy::{
	bootstrap, provision, settings, GatewayError, ManagementClient,
};

#[tokio::test(flavor = "multi_thread")]
#[ignore = "network + spawns a real CLIProxyAPI process"]
async fn provision_boot_and_manage() {
	let root = tempfile::tempdir().expect("root dir");
	let config_dir = tempfile::tempdir().expect("config dir");
	let port = free_port();

	let bin = provision::provision(
		root.path(),
		provision::PINNED_VERSION,
		None,
		|phase, progress| {
			eprintln!("provision: {phase:?} {progress:?}");
		},
	)
	.await
	.expect("provision pinned release");
	assert!(bin.is_file());

	let outcome = bootstrap::ensure_config(config_dir.path(), port, None)
		.expect("bootstrap config");
	let record = GatewayInstanceRecord {
		id: "live-smoke".to_string(),
		name: "live smoke".to_string(),
		kind: GatewayInstanceKind::Managed,
		base_url: format!("http://127.0.0.1:{port}"),
		port: Some(port),
		auto_start: false,
		created_at: chrono::Utc::now().to_rfc3339(),
		provider_projection: Default::default(),
	};
	let client =
		ManagementClient::new(&record.base_url, &outcome.management_key)
			.expect("client");

	let runtime = GatewayRuntime::new();
	runtime
		.start(&record, &bin, &outcome.config_path, &client)
		.await
		.expect("gateway starts and becomes ready");

	// -- contract checks -------------------------------------------------
	client.ping().await.expect("authenticated ping");

	let status = runtime.status(&record, true, &client).await;
	assert_eq!(status, GatewayInstanceStatus::Running);

	for spec in settings::GATEWAY_SETTINGS {
		let value = client
			.setting(spec)
			.await
			.unwrap_or_else(|error| panic!("read {}: {error}", spec.key));
		eprintln!("setting {} = {value:?}", spec.key);
	}

	let debug_spec = settings::find("debug").expect("debug spec");
	client
		.set_setting(debug_spec, &GatewaySettingValue::Bool(true))
		.await
		.expect("enable debug");
	assert_eq!(
		client.setting(debug_spec).await.expect("read back debug"),
		GatewaySettingValue::Bool(true)
	);

	let files = client.auth_files().await.expect("auth-files list");
	eprintln!("auth files: {}", files.len());

	let keys = client.api_keys().await.expect("api-keys");
	assert!(
		!keys.is_empty(),
		"bootstrap config seeds one gateway key; got none"
	);

	let yaml = client.config_yaml().await.expect("config.yaml download");
	assert!(yaml.contains("remote-management"));

	match client.latest_version().await {
		Ok(latest) => {
			assert!(
				!latest.starts_with('v'),
				"latest_version must strip the tag prefix, got {latest}"
			);
			eprintln!("latest release reported: {latest}");
		}
		Err(GatewayError::Management {
			status: 502,
			message,
		}) if message.contains("API rate limit exceeded") => {
			eprintln!("latest release check skipped: {message}");
		}
		Err(error) => panic!("latest-version: {error}"),
	}

	// -- upstream keys ---------------------------------------------------
	client
		.add_upstream_key(
			GatewayUpstreamProvider::Claude,
			"sk-live-smoke",
			Some("https://relay.example.com"),
		)
		.await
		.expect("add claude upstream key");
	let keys = client
		.upstream_keys(GatewayUpstreamProvider::Claude)
		.await
		.expect("list claude upstream keys");
	assert_eq!(keys.len(), 1);
	assert_eq!(keys[0].api_key, "sk-live-smoke");
	assert!(keys[0].auth_index.is_some(), "server assigns auth-index");
	client
		.delete_upstream_key(GatewayUpstreamProvider::Claude, "sk-live-smoke")
		.await
		.expect("delete claude upstream key");
	assert!(client
		.upstream_keys(GatewayUpstreamProvider::Claude)
		.await
		.expect("list after delete")
		.is_empty());

	// -- openai-compatibility relays ------------------------------------
	client
		.add_compat_provider(&GatewayCompatProviderDto {
			name: "live-smoke-relay".to_string(),
			base_url: "https://api.relay.example/v1".to_string(),
			api_keys: vec!["sk-relay-1".to_string()],
			models: vec![GatewayCompatModelDto {
				name: "gpt-4o".to_string(),
				alias: Some("g4o".to_string()),
			}],
			disabled: false,
			auth_index: None,
		})
		.await
		.expect("add relay");
	let relays = client.compat_providers().await.expect("list relays");
	assert_eq!(relays.len(), 1);
	// Keys are write-only: they land in the server's auth store and are
	// never echoed back.
	assert!(relays[0].api_keys.is_empty());
	// Adding a second relay replays the first without keys; its
	// auth-index (the key association) must survive the replay — this is
	// the safety property add_compat_provider relies on.
	let index_before = relays[0].auth_index.clone();
	assert!(index_before.is_some(), "server assigns relay auth-index");
	client
		.add_compat_provider(&GatewayCompatProviderDto {
			name: "live-smoke-relay-b".to_string(),
			base_url: "https://api.relay-b.example/v1".to_string(),
			api_keys: vec!["sk-relay-2".to_string()],
			models: Vec::new(),
			disabled: false,
			auth_index: None,
		})
		.await
		.expect("add second relay");
	let index_after = client
		.compat_providers()
		.await
		.expect("list after second add")
		.into_iter()
		.find(|relay| relay.name == "live-smoke-relay")
		.and_then(|relay| relay.auth_index);
	assert_eq!(
		index_before, index_after,
		"keyless replay must keep the first relay's auth association"
	);
	for name in ["live-smoke-relay", "live-smoke-relay-b"] {
		client
			.delete_compat_provider(name)
			.await
			.expect("delete relay");
	}
	assert!(client
		.compat_providers()
		.await
		.expect("list after relay delete")
		.is_empty());

	// -- logs ------------------------------------------------------------
	let logging = settings::find("logging-to-file").expect("logging spec");
	client
		.set_setting(logging, &GatewaySettingValue::Bool(true))
		.await
		.expect("enable file logging");
	// The log file only fills on activity; provoke one line (the gin
	// logger records every HTTP hit) and poll briefly.
	let mut logs = client.logs().await.expect("read logs");
	for _ in 0..6 {
		if logs.line_count > 0 {
			break;
		}
		let _ = reqwest::get(format!("{}/v1/models", record.base_url)).await;
		tokio::time::sleep(std::time::Duration::from_millis(500)).await;
		logs = client.logs().await.expect("read logs");
	}
	assert!(logs.line_count > 0, "enabled log should have lines");
	client.clear_logs().await.expect("clear logs");

	// -- oauth excluded models ------------------------------------------
	let mut excluded = std::collections::HashMap::new();
	excluded.insert("gemini".to_string(), vec!["gemini-1.5-flash".to_string()]);
	client
		.set_oauth_excluded_models(&excluded)
		.await
		.expect("set oauth excluded models");
	let roundtrip = client
		.oauth_excluded_models()
		.await
		.expect("read oauth excluded models");
	assert_eq!(roundtrip, excluded);

	// -- device-flow auth URLs ------------------------------------------
	for provider in [GatewayOauthProvider::Kimi, GatewayOauthProvider::Xai] {
		let auth = client
			.auth_url(provider)
			.await
			.unwrap_or_else(|error| panic!("{provider:?} auth url: {error}"));
		assert_eq!(auth.flow.as_deref(), Some("device"));
		assert!(auth.user_code.is_some(), "{provider:?} sends a user code");
	}

	// -- error paths -----------------------------------------------------
	let quota_error = client
		.reset_quota("no-such-index")
		.await
		.expect_err("unknown auth_index must fail");
	assert!(matches!(
		quota_error,
		aghub_cliproxy::GatewayError::Management { .. }
	));

	runtime.stop(&record).await.expect("stop gateway");
}

fn free_port() -> u16 {
	std::net::TcpListener::bind("127.0.0.1:0")
		.expect("bind")
		.local_addr()
		.expect("addr")
		.port()
}
