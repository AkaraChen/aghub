use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub struct CreateCredentialRequest {
	pub name: String,
	pub token: String,
}

/// Token is intentionally omitted from responses — write-only secret.
#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct CredentialResponse {
	pub id: String,
	pub name: String,
}
