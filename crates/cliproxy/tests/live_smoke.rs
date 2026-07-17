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
	GatewayInstanceKind, GatewayInstanceStatus, GatewaySettingValue,
};
use aghub_cliproxy::lifecycle::GatewayRuntime;
use aghub_cliproxy::store::GatewayInstanceRecord;
use aghub_cliproxy::{bootstrap, provision, settings, ManagementClient};

#[tokio::test(flavor = "multi_thread")]
#[ignore = "network + spawns a real CLIProxyAPI process"]
async fn provision_boot_and_manage() {
	let root = tempfile::tempdir().expect("root dir");
	let config_dir = tempfile::tempdir().expect("config dir");
	let port = free_port();

	let bin = provision::provision(
		root.path(),
		provision::PINNED_VERSION,
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

	let latest = client.latest_version().await.expect("latest-version");
	eprintln!("latest release reported: {latest}");

	runtime.stop(&record).await.expect("stop gateway");
}

fn free_port() -> u16 {
	std::net::TcpListener::bind("127.0.0.1:0")
		.expect("bind")
		.local_addr()
		.expect("addr")
		.port()
}
