import pytest
from pydantic import ValidationError

from app.config import DEFAULT_SECRET_KEY, Settings


def make(**values) -> Settings:
    return Settings(_env_file=None, **values)


def test_default_secret_is_allowed_for_local_development():
    assert make(secret_key=DEFAULT_SECRET_KEY, cookie_secure=False).cookie_secure is False


def test_production_cookies_reject_the_default_secret():
    with pytest.raises(ValidationError, match="SECRET_KEY"):
        make(secret_key=DEFAULT_SECRET_KEY, cookie_secure=True)


def test_production_cookies_accept_a_real_secret():
    assert make(secret_key="x" * 64, cookie_secure=True).cookie_secure is True
