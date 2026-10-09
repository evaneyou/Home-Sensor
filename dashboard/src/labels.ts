export function networkLabel(network: { slug: string; name: string }): string {
  if (network.slug === "wifi-main") return "Wi-Fi";
  if (network.slug === "wan") return "Internet Service";
  if (network.slug === "wired") return "Wired";
  if (network.slug === "wifi") return "Wireless";
  return network.name;
}

export function networkOrder(network: { slug: string }): number {
  if (network.slug === "wan") return 2;
  if (network.slug === "wired") return 3;
  if (network.slug === "wifi") return 4;
  if (network.slug === "wifi-main") return 1;
  return 0;
}
