#[macro_use]
extern crate rocket;

pub mod dto;
pub mod error;
pub mod extractors;
pub mod routes;
pub mod state;

pub struct ApiOptions {
    pub port: u16,
}

pub async fn start(options: ApiOptions) -> Result<(), rocket::Error> {
    let config = rocket::Config {
        port: options.port,
        address: std::net::IpAddr::V4(std::net::Ipv4Addr::LOCALHOST),
        log_level: rocket::config::LogLevel::Normal,
        ..rocket::Config::default()
    };
    let cors = rocket_cors::CorsOptions {
        allowed_origins: rocket_cors::AllOrSome::All,
        allowed_methods: vec![rocket::http::Method::Get, rocket::http::Method::Post, rocket::http::Method::Put, rocket::http::Method::Delete]
            .into_iter()
            .map(From::from)
            .collect(),
        allowed_headers: rocket_cors::AllowedHeaders::some(&["Authorization", "Accept", "Content-Type"]),
        allow_credentials: true,
        ..Default::default()
    }
    .to_cors().unwrap();
    rocket::custom(config)
        .mount(
            "/api/v1",
            routes![
                routes::agents::list_agents,
                routes::skills::list_all_agents_skills,
                routes::skills::list_skills,
                routes::skills::create_skill,
                routes::skills::get_skill,
                routes::skills::update_skill,
                routes::skills::delete_skill,
                routes::skills::enable_skill,
                routes::skills::disable_skill,
                routes::mcps::list_all_agents_mcps,
                routes::mcps::list_mcps,
                routes::mcps::create_mcp,
                routes::mcps::get_mcp,
                routes::mcps::update_mcp,
                routes::mcps::delete_mcp,
                routes::mcps::enable_mcp,
                routes::mcps::disable_mcp,
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
        .mount("/", rocket_cors::catch_all_options_routes())
        .attach(cors)
        .launch()
        .await
        .map(|_| ())
}
