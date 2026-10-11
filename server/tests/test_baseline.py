"""Steady new normal for check baselines. No database."""

from app.internet_tests import steady_level


def test_steady_run_becomes_the_normal():
    assert 80 < steady_level([80 + i * 0.3 for i in range(12)]) < 84


def test_short_run_is_not_steady():
    assert steady_level([80.0] * 11) is None


def test_step_change_is_not_steady_yet():
    assert steady_level([1.0] * 6 + [80.0] * 6) is None


def test_zeroes_are_not_steady():
    assert steady_level([0.0] * 12) is None
