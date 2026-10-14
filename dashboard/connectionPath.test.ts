import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { adapterLines, tunnelLabel } from "./src/connectionPath.ts";

describe("adapterLines", () => {
  it("names the traffic radio and the passive radio", () => {
    assert.deepEqual(adapterLines("eth0", "wlan0", "wlan1", "kismet"), [
      "Ethernet eth0 · traffic",
      "Wi-Fi wlan0 · traffic",
      "Wi-Fi wlan1 · passive monitoring · Kismet",
    ]);
  });

  it("labels a single Wi-Fi NIC for traffic and passive monitoring", () => {
    assert.deepEqual(adapterLines("end0", "wlan0", null, "scan"), [
      "Ethernet end0 · traffic",
      "Wi-Fi wlan0 · traffic and passive monitoring · scan",
    ]);
  });

  it("leaves a blank when the agent has not reported an adapter", () => {
    assert.deepEqual(adapterLines(null, null, null, "off"), ["Ethernet — · traffic", "Wi-Fi —"]);
  });
});

describe("tunnelLabel", () => {
  it("shows the Pi tunnel address, the server end, and the UDP port", () => {
    assert.equal(tunnelLabel("wired", "10.7.0.8"), "10.7.0.8 → 10.7.0.1 · UDP 51820");
    assert.equal(tunnelLabel("wireless", "10.7.1.8"), "10.7.1.8 → 10.7.1.1 · UDP 51821");
    assert.equal(tunnelLabel("wired", null), "— → 10.7.0.1 · UDP 51820");
  });
});
