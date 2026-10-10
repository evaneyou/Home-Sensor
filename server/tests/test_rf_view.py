"""Channel advice and iw scan parsing. No database."""

from app.rf_view import hill_points, noise_by_frequency, parse_iw_scan, parse_iw_survey, recommend_band

SCAN = """
BSS 11:22:33:44:55:66(on wlan0)
	freq: 2437
	signal: -42.00 dBm
	SSID: Home
	DS Parameter set: channel 6
	HT capabilities:
	HT operation:
		 * primary channel: 6
	RSN:	 * Version: 1
		 * Group cipher: CCMP
	capability: ESS Privacy
BSS aa:bb:cc:dd:ee:01(on wlan0)
	freq: 2412
	signal: -82.00 dBm
	SSID:
	capability: ESS
BSS aa:bb:cc:dd:ee:02(on wlan0)
	freq: 5180
	signal: -55.00 dBm
	SSID: Home5
	DS Parameter set: channel 36
	VHT operation:
		 * channel width: 1 (80 MHz)
	RSN:	 * Version: 1
BSS aa:bb:cc:dd:ee:03(on wlan0)
	freq: 2462
	signal: -90.00 dBm
	SSID: FarAway
	DS Parameter set: channel 11
	WPA:	 * Version: 1
	capability: ESS Privacy
"""


def test_parse_iw_scan_reads_security_width_and_hidden():
    aps = parse_iw_scan(SCAN)
    by_ssid = {ap["ssid"]: ap for ap in aps}
    home = by_ssid["Home"]
    assert home["bssid"] == "11:22:33:44:55:66"
    assert home["band"] == "2.4"
    assert home["channel"] == 6
    assert home["security"] == "WPA2"
    assert home["rssi_dbm"] == -42
    hidden = next(ap for ap in aps if ap["hidden"])
    assert hidden["ssid"] == ""
    assert hidden["channel"] == 1
    five = by_ssid["Home5"]
    assert five["band"] == "5"
    assert five["channel_width"] == 80
    assert by_ssid["FarAway"]["security"] == "WPA"


def test_loud_neighbor_beats_a_faint_one():
    aps = parse_iw_scan(SCAN)
    advice = recommend_band(aps, "2.4")
    assert advice["recommended_channel"] == 11
    assert advice["busiest_channel"] == 6
    assert "quieter" in advice["reason"]


def test_empty_band_suggests_a_clear_channel():
    advice = recommend_band([], "5")
    assert advice["recommended_channel"] == 36
    assert advice["ap_count"] == 0


SURVEY = """
Survey data from wlan1
	frequency:			2412 MHz
	noise:				-95 dBm
	channel active time:		1000 ms
	channel busy time:		250 ms
Survey data from wlan1
	frequency:			2437 MHz
	noise:				-90 dBm
	channel active time:		0 ms
	channel busy time:		0 ms
Survey data from wlan1
	frequency:			5180 MHz
	channel active time:		800 ms
	channel busy time:		80 ms
"""


def test_survey_dump_reads_noise_and_busy_percent():
    rows = {row["channel"]: row for row in parse_iw_survey(SURVEY)}
    assert rows[1]["band"] == "2.4"
    assert rows[1]["noise_dbm"] == -95
    assert rows[1]["busy_pct"] == 25
    assert rows[6]["noise_dbm"] == -90
    assert rows[6]["busy_pct"] is None
    assert rows[36]["band"] == "5"
    assert rows[36]["noise_dbm"] is None
    assert rows[36]["busy_pct"] == 10


def test_scan_noise_comes_from_the_matching_frequency():
    survey = noise_by_frequency(parse_iw_survey(SURVEY))
    aps = {ap["ssid"]: ap for ap in parse_iw_scan(SCAN, survey)}
    assert aps["Home"]["noise_dbm"] == -90
    hidden = next(ap for ap in parse_iw_scan(SCAN, survey) if ap["hidden"])
    assert hidden["noise_dbm"] == -95
    assert aps["FarAway"]["noise_dbm"] is None
    assert parse_iw_scan(SCAN)[0]["noise_dbm"] is None


def test_hill_peaks_on_the_channel():
    points = hill_points({"band": "2.4", "channel": 6, "channel_width": 20, "rssi_dbm": -40})
    peak = max(points, key=lambda point: point["rssi"])
    assert peak["channel"] == 6
    assert peak["rssi"] == -40
    assert points[0]["rssi"] == -100


if __name__ == "__main__":
    test_parse_iw_scan_reads_security_width_and_hidden()
    test_loud_neighbor_beats_a_faint_one()
    test_empty_band_suggests_a_clear_channel()
    test_hill_peaks_on_the_channel()
    print("ok")
