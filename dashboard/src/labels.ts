export function networkLabel(network: { slug: string; name: string }): string {
  if (network.slug === "wifi-main") return "Wi-Fi";
  if (network.slug === "wan") return "Web";
  if (network.slug === "wired") return "Wired";
  if (network.slug === "wifi") return "Wi-Fi";
  return network.name;
}

export function checkLabel(check: { slug?: string | null; name?: string | null }): string {
  if (check.slug === "librespeed" || check.name === "LibreSpeed") return "Bandwidth Test";
  return check.name || check.slug || "";
}

export function networkOrder(network: { slug: string }): number {
  if (network.slug === "wan") return 2;
  if (network.slug === "wired") return 3;
  if (network.slug === "wifi") return 4;
  if (network.slug === "wifi-main") return 1;
  return 0;
}
