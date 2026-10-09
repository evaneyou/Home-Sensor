from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://hns:hns-dev-password@127.0.0.1:55432/hns"
    secret_key: str = "dev-secret-change-me-in-production"
    cors_origins: str = "http://127.0.0.1:3847,http://localhost:3847"
    cookie_secure: bool = False
    cookie_samesite: str = "lax"
    session_cookie_name: str = "hns_session"
    session_max_age: int = 60 * 60 * 24 * 7

    bootstrap_admin_username: str = "admin"
    bootstrap_admin_password: str = "admin-change-me"
    bootstrap_viewer_username: str = "viewer"
    bootstrap_viewer_password: str = "viewer-change-me"
    wireguard_endpoint: str = "10.0.0.123:51820"
    wireguard_state_dir: str = ""
    # Remote agents pin this key, so check-in and poll only answer over HTTPS.
    agent_require_https: bool = True
    tls_dir: str = "/var/lib/hns-tls"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
