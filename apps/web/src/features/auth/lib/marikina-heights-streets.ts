/**
 * Curated streets in Barangay Marikina Heights, Marikina City.
 * Sources: OpenStreetMap via philippines-streets.openalfa.com/marikina-heights,
 * BIR zonal value street listings, and commonly known local roads.
 */
export const MARIKINA_HEIGHTS_STREETS = [
  "10th Avenue",
  "11th Avenue",
  "2nd Street",
  "3rd Street",
  "4th Street",
  "5th Avenue",
  "8th Avenue",
  "9th Avenue",
  "Aba Street",
  "Apitong Street",
  "Aquarius Street",
  "Ariane Road",
  "Bamboo Palm Street",
  "Bayan-Bayanan Avenue",
  "Bayan-Bayanan Extension",
  "Betel Nut Street",
  "Bethlehem Street",
  "Big Bird Street",
  "Bob White Street",
  "Bonanza Street",
  "Bougainvillea Lane",
  "Branding Iron Street",
  "Buffallo Street",
  "Cacharel Street",
  "Capricorn Street",
  "Champaca Street",
  "Champagnat Street",
  "Coco Palm Street",
  "Colt Street",
  "Corral Street",
  "Dao Street",
  "Date Palm Street",
  "Daylight Street",
  "Diamond Street",
  "E. Rodriguez Street",
  "East Drive Street",
  "Emerald Street",
  "F. Balagtas Street",
  "Fall Street",
  "Fatima Lane Street",
  "G. del Pilar Street",
  "Gardenia Drive",
  "Gardenia Lane",
  "Gemini Street",
  "General B. G. Molina Street",
  "General Meñez Street",
  "General Ordoñez Street",
  "Givenchy Street",
  "Gomez Street",
  "Gucci Street",
  "Halston Street",
  "Hereford Street",
  "Hornbill Street",
  "Ipil Street",
  "Ivory Palm Street",
  "J. J. Carlos Circle",
  "J. Molina Street",
  "Jade Street",
  "Jasmin Street",
  "Jerusalem Street",
  "Kaginhawahan Street",
  "Kapayapaan Street",
  "Kasaganaan Street",
  "Katarungan Street",
  "Katipunan Street",
  "Ladislao Diwa Street",
  "Lakandula Extension",
  "Lakandula Street",
  "Lauren Street",
  "Leo Street",
  "Libra Street",
  "Liwasang Kalayaan Street",
  "Long Horn Street",
  "Lope K. Santos Street",
  "Lopez Jaena Street",
  "Lourdes Drive Street",
  "Lourdes Street",
  "Lower Paraiso",
  "M. L. Quezon Street",
  "M. Tuazon Street",
  "Mañacop Street",
  "Malipajo Street",
  "Mansanas Street",
  "Mansanitas Street",
  "Merino Street",
  "Mohair Street",
  "Mohawk Street",
  "Monserrat Hill Street",
  "N. Sevilla Street",
  "Narra Street",
  "Northwest Street",
  "Opal Street",
  "P. Burgos Street",
  "P. Lopez Street",
  "P. Paterno Street",
  "P. Valenzuela Street",
  "Paddock Street",
  "Padre Gomez Street",
  "Palm Drive",
  "Palomino Street",
  "Paraiso Street",
  "Pisces Street",
  "Pony Street",
  "Puffin Street",
  "Queen Palm Street",
  "R. Magsaysay Street",
  "Rajah Matanda Street",
  "Rancho Avenue",
  "Remuda Street",
  "Rodeanna Street",
  "Rodeo Street",
  "Royal Palm Street",
  "Ruby Street",
  "Sagittarius Street",
  "Saint Joseph Street",
  "Saint Jude Street",
  "Sampaguita Lane",
  "Santa Bernardita",
  "Santa Elena Street",
  "Santa Isabel Street",
  "Santa Monica Street",
  "Santa Veronica Street",
  "Sapphire Street",
  "Spring Street",
  "Spur Street",
  "Stallion Street",
  "Sumulong Street",
  "T. Bugallon Extension",
  "Tanguile Street",
  "Tatiana Street",
  "Teodora Park",
  "Torres Bugallon Street",
  "Virgo Street",
  "West Drive Street",
  "Winter Street",
  "Wrangler Street",
  "Zamora Street",
] as const

export type MarikinaHeightsStreet = (typeof MARIKINA_HEIGHTS_STREETS)[number]

function normalizeStreetKey(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\b(street|st|avenue|ave|road|rd|drive|dr|lane|ln|extension|ext|circle|park|hill)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

const STREET_LOOKUP = new Map(
  MARIKINA_HEIGHTS_STREETS.map((street) => [normalizeStreetKey(street), street]),
)

export function isKnownMarikinaHeightsStreet(street: string) {
  if (!street?.trim()) return false
  if (MARIKINA_HEIGHTS_STREETS.includes(street as MarikinaHeightsStreet)) return true
  return STREET_LOOKUP.has(normalizeStreetKey(street))
}

/**
 * Match a road string to a curated Marikina Heights street.
 * Avoids loose substring hits (e.g. "Eastern Manila District" → "East Drive"
 * because both contain "east").
 */
export function matchMarikinaHeightsStreet(input: string): string | null {
  if (!input?.trim()) return null
  const raw = input.trim()

  // Never treat bare admin / city labels as street names
  if (
    /^(barangay\b|district\b|metro\b|eastern\b|manila\b|philippines\b|marikina(\s+city)?\b|marikina heights\b)/i.test(
      raw,
    ) &&
    !/\b(street|st\.?|avenue|ave\.?|road|rd\.?|drive|dr\.?|lane|ln\.?|extension|ext\.?)\b/i.test(raw)
  ) {
    return null
  }

  const exact = MARIKINA_HEIGHTS_STREETS.find(
    (street) => street.toLowerCase() === raw.toLowerCase(),
  )
  if (exact) return exact

  const key = normalizeStreetKey(raw)
  if (!key || key.length < 3) return null

  const direct = STREET_LOOKUP.get(key)
  if (direct) return direct

  // Token match only — never bare substring ("east" inside "eastern")
  const keyTokens = new Set(key.split(" ").filter(Boolean))
  let best: { street: string; score: number } | null = null

  for (const [knownKey, street] of STREET_LOOKUP.entries()) {
    if (!knownKey || knownKey.length < 3) continue
    const knownTokens = knownKey.split(" ").filter(Boolean)
    if (knownTokens.length === 0) continue

    // Every curated token must appear as a full word in the input
    if (!knownTokens.every((t) => keyTokens.has(t))) continue

    const score = knownTokens.join(" ").length
    if (!best || score > best.score) best = { street, score }
  }

  return best?.street ?? null
}

export function filterMarikinaHeightsStreets(query: string, limit = 40) {
  const q = query.trim().toLowerCase()
  if (!q) return [...MARIKINA_HEIGHTS_STREETS].slice(0, limit)
  return MARIKINA_HEIGHTS_STREETS.filter((street) => street.toLowerCase().includes(q)).slice(
    0,
    limit,
  )
}

export function formatStreetAddress(street: string, houseNumber?: string) {
  const house = houseNumber?.trim()
  const streetPart = house ? `${house} ${street}` : street
  return `${streetPart}, Marikina Heights, Marikina City`
}
