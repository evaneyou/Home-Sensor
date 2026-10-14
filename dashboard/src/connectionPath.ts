export const WIRED_TUNNEL_SERVER = "10.7.0.1";
export const WIRELESS_TUNNEL_SERVER = "10.7.1.1";

export function captureLabel(mode: string | null | undefined): string | null {
  if (mode === "kismet") return "Kismet";
  if (mode === "scan") return "scan";
  return null;
}

/** Ethernet plus the Wi-Fi adapters. One NIC is labeled for traffic and listening. */
export function adapterLines(
  wired: string | null | undefined,
  link: string | null | undefined,
  radio: string | null | undefined,
  mode: string | null | undefined,
): string[] {
  const capture = captureLabel(mode);
  const listening = capture ? ` · ${capture}` : "";
  const lines = [`Ethernet ${wired || "—"} · traffic`];
  if (link && radio && radio !== link) {
    lines.push(`Wi-Fi ${link} · traffic`);
    lines.push(`Wi-Fi ${radio} · passive monitoring${listening}`);
  } else if (link || radio) {
    lines.push(`Wi-Fi ${link || radio} · traffic and passive monitoring${listening}`);
  } else {
    lines.push("Wi-Fi —");
  }
  return lines;
}

export function tunnelLabel(kind: "wired" | "wireless", local: string | null | undefined): string {
  const address = local || "—";
  if (kind === "wired") return `${address} → ${WIRED_TUNNEL_SERVER} · UDP 51820`;
  return `${address} → ${WIRELESS_TUNNEL_SERVER} · UDP 51821`;
}
