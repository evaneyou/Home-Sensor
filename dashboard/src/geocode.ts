const COUNTRY_CODES: Record<string, string> = {
  "United States": "US",
  Canada: "CA",
};

export type CityMatch = {
  name: string;
  region: string;
  country: string;
  latitude: number;
  longitude: number;
};

type PhotonFeature = {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    name?: string;
    state?: string;
    country?: string;
    countrycode?: string;
    type?: string;
  };
};

export function cityPlace(match: CityMatch): string {
  return [match.name, match.region, match.country].filter(Boolean).join(", ");
}

export async function lookupCities(city: string, country: string, region: string): Promise<CityMatch[]> {
  const code = COUNTRY_CODES[country];
  if (!code) throw new Error("Choose United States or Canada.");
  const query = region ? `${city}, ${region}` : city;
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=15&lang=en`;
  let body: { features?: PhotonFeature[] };
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error("Could not look up that city.");
    body = (await res.json()) as { features?: PhotonFeature[] };
  } catch (error) {
    if (error instanceof Error && error.message === "Could not look up that city.") throw error;
    throw new Error("Could not look up that city.");
  }
  const seen = new Set<string>();
  const matches: CityMatch[] = [];
  for (const feature of body.features ?? []) {
    const props = feature.properties;
    const coords = feature.geometry?.coordinates;
    if (!props?.name || props.countrycode !== code || props.type !== "city" || !coords) continue;
    if (region && (props.state ?? "").toLowerCase() !== region.toLowerCase()) continue;
    const key = `${props.name.toLowerCase()}|${(props.state ?? "").toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    matches.push({
      name: props.name,
      region: props.state ?? "",
      country: props.country || country,
      longitude: coords[0],
      latitude: coords[1],
    });
  }
  return matches;
}
