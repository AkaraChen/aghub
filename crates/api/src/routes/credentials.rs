use log::{debug, info};
use rocket::http::Status;
use rocket::serde::json::Json;
use serde::{Deserialize, Serialize};

use crate::dto::credential::{CreateCredentialRequest, CredentialResponse};
use crate::error::{ApiCreated, ApiNoContent, ApiResult};

const SERVICE: &str = "aghub";
const USER: &str = "github_credentials";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct StoredCredential {
	pub(crate) id: String,
	pub(crate) name: String,
	pub(crate) token: String,
}

fn get_entry() -> Result<keyring::Entry, String> {
	keyring::Entry::new(SERVICE, USER).map_err(|e| e.to_string())
}

pub(crate) fn load_credentials() -> Result<Vec<StoredCredential>, String> {
	let entry = get_entry()?;
	match entry.get_password() {
		Ok(json) => serde_json::from_str(&json).map_err(|e| e.to_string()),
		Err(keyring::Error::NoEntry) => Ok(vec![]),
		Err(e) => Err(e.to_string()),
	}
}

fn store_credentials(creds: &[StoredCredential]) -> Result<(), String> {
	let entry = get_entry()?;
	if creds.is_empty() {
		match entry.delete_credential() {
			Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
			Err(e) => Err(e.to_string()),
		}
	} else {
		let json = serde_json::to_string(creds).map_err(|e| e.to_string())?;
		entry.set_password(&json).map_err(|e| e.to_string())
	}
}

fn internal_err(msg: impl Into<String>) -> crate::error::ApiError {
	crate::error::ApiError::new(
		Status::InternalServerError,
		msg,
		"KEYCHAIN_ERROR",
	)
}

#[get("/credentials")]
pub fn list_credentials() -> ApiResult<Vec<CredentialResponse>> {
	let creds = load_credentials().map_err(internal_err)?;
	debug!("loaded {} stored credentials", creds.len());
	Ok(Json(
		creds
			.into_iter()
			.map(|c| CredentialResponse {
				id: c.id,
				name: c.name,
			})
			.collect(),
	))
}

#[post("/credentials", data = "<body>")]
pub fn create_credential(
	body: Json<CreateCredentialRequest>,
) -> ApiCreated<CredentialResponse> {
	let mut creds = load_credentials().map_err(internal_err)?;
	info!("creating credential '{}'", body.name);
	let new = StoredCredential {
		id: uuid::Uuid::new_v4().to_string(),
		name: body.name.clone(),
		token: body.token.clone(),
	};
	creds.push(new.clone());
	store_credentials(&creds).map_err(internal_err)?;
	Ok((
		Status::Created,
		Json(CredentialResponse {
			id: new.id,
			name: new.name,
		}),
	))
}

#[delete("/credentials/<id>")]
pub fn delete_credential(id: &str) -> ApiNoContent {
	let mut creds = load_credentials().map_err(internal_err)?;
	let original_len = creds.len();
	creds.retain(|c| c.id != id);
	info!(
		"deleting credential '{id}', removed={}",
		original_len != creds.len()
	);
	store_credentials(&creds).map_err(internal_err)?;
	Ok(rocket::response::status::NoContent)
}
