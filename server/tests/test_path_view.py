from app.path_view import build_trace


def _hop(**kwargs):
    base = {
        "loss_pct": 0,
        "best_ms": 1,
        "avg_ms": 1,
        "worst_ms": 1,
    }
    base.update(kwargs)
    return base


def test_mockup_groups_silent_hop_and_matching_path():
    hops = [
        _hop(ttl=1, ip="192.168.1.1", avg_ms=0.6, best_ms=0.5, worst_ms=0.9, as_name="Private address space"),
        _hop(ttl=2, ip="198.51.100.1", avg_ms=9.2, asn=7922, as_name="Comcast"),
        _hop(ttl=3, ip="198.51.100.22", avg_ms=10.4, asn=7922, as_name="Comcast"),
        _hop(ttl=4, ip="198.51.100.130", avg_ms=12.1, asn=7922, as_name="Comcast"),
        _hop(ttl=5, ip="203.0.113.9", avg_ms=13.0, role="ixp", ixp_name="Equinix Ashburn", name="Equinix Ashburn"),
        _hop(ttl=6, ip="203.0.113.41", avg_ms=14.2, asn=3356, as_name="Lumen"),
        _hop(ttl=7, ip="203.0.113.77", avg_ms=15.0, asn=3356, as_name="Lumen"),
        _hop(ttl=8, host="???", loss_pct=100, avg_ms=0, best_ms=0, worst_ms=0),
        _hop(ttl=9, ip="192.0.2.9", avg_ms=38.6, asn=31898, as_name="Oracle Cloud"),
        _hop(ttl=10, ip="192.0.2.50", avg_ms=39.1, asn=31898, as_name="Oracle Cloud"),
    ]
    trace = build_trace(hops, announced=[7922, 3356, 31898])
    roles = [group["role"] for group in trace["groups"]]
    assert roles == ["home", "isp", "ixp", "transit", "unknown", "destination"]
    unknown = trace["groups"][4]
    assert unknown["hop_ttls"] == [8]
    assert unknown["delta_in_ms"] is None
    destination = trace["groups"][-1]
    assert destination["delta_in_ms"] == 23.6
    assert trace["warn_ttls"] == [9]
    inferred = {hop["ttl"] for hop in trace["hops"] if hop["inferred"]}
    assert inferred == {6, 9}
    assert trace["bgp"]["path_match"] is True
    assert [item["type"] for item in trace["as_path_observed"]] == ["as", "ixp", "as", "as"]
    assert "Hop 8 stays silent" in trace["insight"]


def test_consecutive_silent_hops_stay_separate():
    hops = [
        _hop(ttl=1, ip="192.168.0.1", avg_ms=1),
        _hop(ttl=2, host="???", loss_pct=100, avg_ms=0),
        _hop(ttl=3, host="?", loss_pct=100, avg_ms=0),
        _hop(ttl=4, ip="192.0.2.10", avg_ms=20),
    ]
    trace = build_trace(hops)
    unknown = [group for group in trace["groups"] if group["role"] == "unknown"]
    assert [group["hop_ttls"] for group in unknown] == [[2], [3]]
    assert all(group["delta_in_ms"] is None for group in unknown)


def test_cgnat_is_home_and_unenriched_public_hops_group_as_isp():
    hops = [
        _hop(ttl=1, ip="100.64.0.1", avg_ms=0.4),
        _hop(ttl=2, ip="198.51.100.8", avg_ms=11),
        _hop(ttl=3, ip="198.51.100.9", avg_ms=12),
        _hop(ttl=4, ip="192.0.2.20", avg_ms=30),
    ]
    trace = build_trace(hops, isp_name="Comcast")
    assert [group["role"] for group in trace["groups"]] == ["home", "isp", "destination"]
    assert trace["groups"][1]["name"] == "Comcast"
    assert trace["groups"][1]["hop_ttls"] == [2, 3]
    assert trace["groups"][1]["delta_in_ms"] == 10.6
    dest = next(hop for hop in trace["hops"] if hop["ttl"] == 4)
    assert dest["asn"] is None
    assert dest["prefix"] is None
    assert dest["rdns"] is None
    assert trace["bgp"]["path_match"] is None
    assert trace["bgp"]["rpki"] is None


def test_announced_path_mismatch_ignores_ixp():
    hops = [
        _hop(ttl=1, ip="198.51.100.1", avg_ms=5, asn=7922, as_name="Comcast"),
        _hop(ttl=2, ip="203.0.113.9", avg_ms=6, role="ixp", ixp_name="Equinix Ashburn"),
        _hop(ttl=3, ip="192.0.2.50", avg_ms=20, asn=31898, as_name="Oracle Cloud"),
    ]
    match = build_trace(hops, announced=[7922, 31898])
    assert match["bgp"]["path_match"] is True
    mismatch = build_trace(hops, announced=[7922, 3356, 31898])
    assert mismatch["bgp"]["path_match"] is False


def test_large_step_marks_only_the_entering_hop():
    hops = [
        _hop(ttl=1, ip="192.168.1.1", avg_ms=1),
        _hop(ttl=2, ip="198.51.100.1", avg_ms=4, asn=7922, as_name="Comcast"),
        _hop(ttl=3, ip="203.0.113.41", avg_ms=40, asn=3356, as_name="Lumen"),
        _hop(ttl=4, ip="203.0.113.42", avg_ms=41, asn=3356, as_name="Lumen"),
    ]
    trace = build_trace(hops)
    assert trace["warn_ttls"] == [3]
    assert trace["focus_ttl"] == 3
    assert trace["stats"]["biggest_step_ms"] == 36.0


if __name__ == "__main__":
    test_mockup_groups_silent_hop_and_matching_path()
    test_consecutive_silent_hops_stay_separate()
    test_cgnat_is_home_and_unenriched_public_hops_group_as_isp()
    test_announced_path_mismatch_ignores_ixp()
    test_large_step_marks_only_the_entering_hop()
    print("ok")
