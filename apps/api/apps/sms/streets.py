"""Curated streets in Barangay Marikina Heights, Marikina City.

The frontend keeps the same list in
`apps/web/src/features/auth/lib/marikina-heights-streets.ts` for address
picking; the backend copy exists so SMS AI assist can check a street name the
model extracted from a text message against the barangay's real streets.

Sources: OpenStreetMap via philippines-streets.openalfa.com/marikina-heights,
BIR zonal value street listings, and commonly known local roads.
"""

from __future__ import annotations

import re
import unicodedata

MARIKINA_HEIGHTS_STREETS = [
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
]

_SUFFIX_WORDS = (
    "street",
    "st",
    "avenue",
    "ave",
    "road",
    "rd",
    "drive",
    "dr",
    "lane",
    "ln",
    "extension",
    "ext",
    "circle",
    "park",
    "hill",
)

_SUFFIX_RE = re.compile(
    r"\b(" + "|".join(_SUFFIX_WORDS) + r")\b",
    re.IGNORECASE,
)


def _strip_accents(value: str) -> str:
    decomposed = unicodedata.normalize("NFD", value)
    return "".join(char for char in decomposed if not unicodedata.combining(char))


def _normalise_key(value: str) -> str:
    text = _strip_accents(value.lower())
    text = re.sub(r"[^\w\s]", " ", text)
    text = _SUFFIX_RE.sub(" ", text)
    return re.sub(r"\s+", " ", text).strip()


def _tokens(value: str) -> set[str]:
    return set(value.split())


def match_street(input_text: str) -> str:
    """Best known Marikina Heights street inside ``input_text``, or "".

    Every curated street token must appear as a full word; the longest match
    wins, so a message naming "Bayan-Bayanan Avenue" never degrades to the
    shorter "Bayan-Bayanan". A bare street word missing its suffix ("champaca")
    is retried with "Street" appended.
    """
    raw = str(input_text or "").strip()
    if not raw:
        return ""

    candidates = [raw]
    if not _SUFFIX_RE.search(raw):
        candidates.append(f"{raw} Street")

    best = ""
    best_score = 0
    for candidate in candidates:
        key = _normalise_key(candidate)
        if len(key) < 3:
            continue
        key_tokens = _tokens(key)
        for street in MARIKINA_HEIGHTS_STREETS:
            known_key = _normalise_key(street)
            known_tokens = _tokens(known_key)
            if not known_tokens or not known_tokens.issubset(key_tokens):
                continue
            if len(known_key) > best_score:
                best = street
                best_score = len(known_key)
    return best
