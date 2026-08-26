//! CLIProxyAPI gateway integration.
//!
//! aghub can *manage* a local CLIProxyAPI instance (download the binary,
//! own the process) or *connect* to an external one (address + management
//! key); either way all state lives in CLIProxyAPI's own `config.yaml` and
//! auth-dir, reached through its management API — aghub keeps no shadow
//! copy of gateway configuration. This crate provides:
//!
//! * [`client::ManagementClient`] — typed wrapper for the endpoint subset
//!   aghub uses (`/v0/management`),
//! * [`store`] — instance records (`instances.json`) + keyring-held keys,
//! * [`provision`] — pinned-version binary download with checksum check,
//! * [`lifecycle`] — spawn/health/stop/adopt for the managed process,
//! * [`bootstrap`] — first-run `config.yaml` generation,
//! * [`settings`] — the descriptor table driving the settings panel.

pub mod bootstrap;
pub mod client;
pub mod dto;
pub mod error;
pub mod lifecycle;
pub mod provision;
pub mod settings;
pub mod store;

pub use client::ManagementClient;
pub use dto::*;
pub use error::{GatewayError, Result};
pub use settings::{GatewaySettingSpec, GATEWAY_SETTINGS};
pub use store::{
	GatewayInstanceRecord, GatewayKeyStore, GatewayProviderProjection,
	InstanceStore, NativeGatewayKeyStore,
};
