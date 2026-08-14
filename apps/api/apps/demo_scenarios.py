"""Demo content grounded in real Marikina barangay life.

Every concern below is a complaint barangays actually receive: creek backflow
through manholes during habagat, canals clogged with plastic, videoke past
curfew, uncollected garbage. Residents write the way residents write — Taglish,
not textbook English.

Categories and emergency types here are only the ones the database actually has
configured. Nothing invents a category the barangay has not set up.

Sources for the situations modelled:
  Marikina drainage / creek backflow and pumping stations
    https://www.manilatimes.net/2026/07/17/news/national/marikina-eyes-solution-to-san-roque-flooding/2386128
    https://mb.com.ph/2026/08/11/marikina-cainta-conduct-cleanup-ops-amid-habagat
    https://tribune.net.ph/2026/08/11/marikina-now-flood-free-clearing-operations-underway
  Trash as a flooding cause
    https://www.sunstar.com.ph/cebu/espinoza-trash-and-flooding-whose-problem
  Barangay noise / nuisance / dumping complaints and Katarungang Pambarangay
    https://www.respicio.ph/commentaries/how-to-file-a-barangay-complaint-for-noise-disturbance-and-nuisance
    https://www.respicio.ph/commentaries/barangay-complaint-for-neighbor-dumping-trash-on-property
  Who repairs a barangay canal
    https://www.respicio.ph/commentaries/barangay-drainage-disputes-in-the-philippines-who-is-responsible-for-canal-repairs
"""

# Concern categories are matched by the configured category NAME, so a barangay
# that renames one still seeds correctly.
INFRASTRUCTURE = "Infrastructure"
ENVIRONMENT = "Environment"
PUBLIC_SAFETY = "Public Safety"

# Every photo is one specific, reviewed Wikimedia Commons file, pinned by title.
# Searching returned things like "Flood Street, Chelsea" (a street name) and
# "Pothole primer" (a document cover) for these terms, so the caption and the
# picture stopped agreeing. Pinning fixes that.
#
# `blur` marks images that contain a face or a plate. Those exist on purpose:
# they are what proves the privacy pipeline actually redacts before publishing.
PHOTOS = {
    "canal_blocked": {"title": "Maligaya Bridge Creek 04.jpg"},
    "creek_waste": {"title": "Maligaya Bridge Creek 05.jpg"},
    "creek_pollution": {"title": "Maligaya Bridge Creek 12.jpg"},
    "flooded_street": {"title": "Ondoy (3967857165).jpg"},
    "garbage_truck": {"title": "Waste collection truck in the Philippines.jpg"},
    "garbage_street": {"title": "Garbage truck in Alaminos, Laguna 2.jpg"},
    "drainage_works": {"title": "2383Stonemasons and carpenters at work with drainage construction 17.jpg"},
    "street_scene": {"title": "1955Walking taho street vendors in the Philippines 11.jpg", "blur": True},
    "traffic_plates": {"title": "Traffic Laoag. Ilocos Norte. Philippines. (15442228693).jpg", "blur": True},
    "tricycle_people": {"title": "Tricycle overloaded.jpg", "blur": True},
    "askal": {"title": "Askal (aspin) dog Masinloc, Zambales.jpg"},
    "askal_lying": {"title": "1776Limping Askal Lying Askal 08.jpg"},
    "street_night": {"title": "Diversion Road, Mandurriao, Iloilo City, Philippines at night with parol along the avenue.png"},
    "river_works": {"title": "Marikina River.jpg"},
    "marikina_heights": {"title": "Bayani Monuments in Marikina Heights, May 2026.jpg"},
}


def concern(**kwargs):
    kwargs.setdefault("photo", None)
    kwargs.setdefault("group", None)
    kwargs.setdefault("chat", [])
    kwargs.setdefault("days_ago", 5)
    kwargs.setdefault("outside_zone", False)
    kwargs.setdefault("street", "")
    return kwargs


# ---------------------------------------------------------------------------
# The merged set: one blocked canal, reported by three neighbours on the same
# stretch within two days. This is the case the merge UI exists for.
# ---------------------------------------------------------------------------

CANAL_GROUP = "canal-champaca"

CONCERNS = [
    concern(
        group=CANAL_GROUP,
        primary=True,
        category=INFRASTRUCTURE,
        status="resolved",
        days_ago=16,
        street="Champaca Street",
        photo="canal_blocked",
        title="Baradong kanal sa Champaca Street, umaapaw kapag umuulan",
        description=(
            "Barado na po ang kanal sa harap ng 24 Champaca Street. Kapag malakas ang ulan, "
            "umaatras ang tubig palabas ng manhole at umaabot hanggang bakuran namin. Puro "
            "plastik at putik po ang nakabara. Baka po pwedeng ma-declog bago pa lumakas ang habagat."
        ),
        chat=[
            ("official", "Salamat sa report po. Ipapaschedule namin ang declogging sa Public Works ngayong linggo."),
            ("reporter", "Salamat po. Tumataas na po talaga kapag hapon nagsisimula ang ulan."),
            ("official", "Naka-schedule na po sa Miyerkules ng umaga. Pakialis na lang po muna ang mga naka-park na sasakyan sa tapat."),
            ("reporter", "Noted po, sasabihan ko po ang mga kapitbahay."),
            ("official", "Tapos na po ang declogging kanina. Nakuha po ang mga plastik at putik. Pakibantayan po kapag umulan ulit."),
        ],
    ),
    concern(
        group=CANAL_GROUP,
        category=INFRASTRUCTURE,
        status="resolved",
        days_ago=15,
        street="Champaca Street",
        photo="creek_pollution",
        title="Umaapaw ang tubig sa kanal malapit sa 30 Champaca",
        description=(
            "Same po sa nauna kong kapitbahay — hindi umaagos ang tubig sa kanal. Tuwing "
            "hapon na maulan umaapaw po hanggang kalsada. Ang baho na rin po."
        ),
    ),
    concern(
        group=CANAL_GROUP,
        category=INFRASTRUCTURE,
        status="resolved",
        days_ago=14,
        street="Champaca Street",
        photo="flooded_street",
        title="Clogged drainage Champaca St — ankle deep na ang tubig",
        description=(
            "Ankle deep na po ang tubig sa gitna ng kalsada tuwing umuulan. Mukhang barado "
            "ang kanal papuntang creek. Delikado po sa mga bata na dumadaan papuntang school."
        ),
    ),
    # -----------------------------------------------------------------------
    # Infrastructure
    # -----------------------------------------------------------------------
    concern(
        category=INFRASTRUCTURE,
        status="in_progress",
        days_ago=9,
        street="Ipil Street",
        photo="street_night",
        title="Walang ilaw ang poste sa kanto ng Ipil Street at Narra",
        description=(
            "Isang linggo na pong patay ang streetlight sa kanto. Madilim po talaga pagsapit "
            "ng gabi at may mga estudyante pa pong dumadaan galing sa review class. Sana po "
            "mapalitan na ang bombilya."
        ),
        chat=[
            ("official", "Received po. Naka-endorse na sa Infrastructure Committee para sa replacement."),
            ("reporter", "Salamat po. Kahit temporary lighting muna po sana."),
        ],
    ),
    concern(
        category=INFRASTRUCTURE,
        status="assigned",
        days_ago=6,
        street="Narra Street",
        photo="traffic_plates",
        title="Malalim na lubak sa Narra Street, may nadulas nang motor",
        description=(
            "May malalim pong lubak sa Narra Street malapit sa tindahan. Kagabi po may "
            "motorcycle na nadulas doon. Lumalaki po lalo kapag inuulan."
        ),
    ),
    concern(
        category=INFRASTRUCTURE,
        status="under_review",
        days_ago=4,
        street="Dao Street",
        photo="drainage_works",
        title="Sirang takip ng kanal sa tapat ng day-care",
        description=(
            "Nabasag po ang concrete cover ng kanal sa tapat ng day-care center. Bukas po "
            "ang butas at delikado sa mga bata. Pinatungan lang po muna ng kahoy ng mga tao."
        ),
    ),
    # -----------------------------------------------------------------------
    # Environment
    # -----------------------------------------------------------------------
    concern(
        category=ENVIRONMENT,
        status="in_progress",
        days_ago=8,
        street="Dao Street",
        photo="garbage_truck",
        title="Hindi nakolekta ang basura sa Dao Street, 4 na araw na",
        description=(
            "Apat na araw na pong hindi nakokolekta ang basura namin sa Dao. "
            "Nagkalat na po ang mga sako at may amoy na. Natatakot po kami sa lamok at daga."
        ),
        chat=[
            ("official", "Pasensya na po. May problema sa truck schedule. Ipapasundo po namin bukas ng umaga."),
            ("reporter", "Salamat po. Sana po hindi na maulit kasi nangangamoy na talaga."),
            ("official", "Nakolekta na po kanina. Naibalik na po sa regular schedule ang Dao."),
        ],
    ),
    concern(
        category=ENVIRONMENT,
        status="assigned",
        days_ago=11,
        street="Ipil Street",
        photo="creek_waste",
        title="May nagtatapon ng construction debris sa creek tuwing gabi",
        description=(
            "May nagdadala po ng construction debris sa creek easement tuwing gabi, mga "
            "alas-diyes pataas. Nakakabara po ito sa daluyan ng tubig at isa po ito sa "
            "dahilan bakit mabilis umapaw kapag umuulan."
        ),
    ),
    concern(
        category=ENVIRONMENT,
        status="rejected",
        days_ago=19,
        street="Katipunan Street",
        photo="garbage_street",
        title="Amoy sunog na plastik tuwing gabi sa likod ng Katipunan",
        description=(
            "May nagsusunog po ng basura sa bakanteng lote sa likod ng Katipunan Street. "
            "Amoy na amoy po ang plastik at nakakahirapan huminga ang lola ko."
        ),
    ),
    # -----------------------------------------------------------------------
    # Public Safety
    # -----------------------------------------------------------------------
    concern(
        category=PUBLIC_SAFETY,
        status="resolved",
        days_ago=13,
        street="Jasmin Street",
        photo="street_scene",
        title="Videoke hanggang madaling araw tuwing weekend sa Jasmin",
        description=(
            "Tuwing Sabado po hanggang alas-una ng madaling araw ang videoke sa Jasmin "
            "Street. Hindi po makatulog ang mga bata at may may-sakit po kaming kasama sa bahay. "
            "Nakiusap na po kami ng maayos pero hindi po pinapansin."
        ),
        chat=[
            ("official", "Naitala na po namin. Ipapatawag po namin sila sa barangay para sa pag-uusap."),
            ("reporter", "Salamat po. Ayaw po naming mag-away, gusto lang po naming makatulog."),
            ("official", "Nagkaroon po ng pag-uusap sa Lupon. Pumayag po silang hanggang alas-diyes na lang ng gabi."),
        ],
    ),
    concern(
        category=PUBLIC_SAFETY,
        status="under_review",
        days_ago=5,
        street="Apitong Street",
        photo="tricycle_people",
        title="Mabilis ang mga tricycle sa harap ng elementary school",
        description=(
            "Sobrang bilis po ng mga tricycle tuwing dismissal sa harap ng school. Muntik na "
            "pong masagasaan ang isang bata kahapon. Sana po may humpback o signage."
        ),
    ),
    concern(
        category=PUBLIC_SAFETY,
        status="submitted",
        days_ago=2,
        street="Dao Street",
        photo="askal",
        title="Maraming askal na nagkakalat sa tapat ng day-care tuwing umaga",
        description=(
            "May apat pong askal na palaging nasa tapat ng day-care tuwing umaga. "
            "Natatakot po ang mga bata, minsan po sumusunod pa. Baka po pwedeng ma-impound "
            "o mabakunahan man lang."
        ),
    ),
    # Deliberately outside the configured acceptance radius, so the demo shows
    # what the barangay's out_of_zone_action actually does.
    concern(
        category=PUBLIC_SAFETY,
        status="submitted",
        days_ago=1,
        outside_zone=True,
        photo="askal_lying",
        title="Sirang kalsada at walang ilaw sa likod ng covered court",
        description=(
            "Madilim po at hindi patag ang daan sa likod ng covered court. Madalas po "
            "may nagtatambay doon kapag gabi at hindi po sila nakikita ng tanod."
        ),
    ),
]


# ---------------------------------------------------------------------------
# Emergencies. `type` values must exist in EmergencyCategory; the seeder skips
# any that the barangay has not configured.
# ---------------------------------------------------------------------------

EMERGENCIES = [
    {
        "type": "flood",
        "status": "resolved",
        "hours_ago": 30,
        "assign": "resolved",
        "trail": ["submitted", "routing", "routed", "acknowledged", "en_route", "arrived", "in_progress", "resolved"],
        "place": "Champaca Street corner creek easement",
        "note": "Umatras ang tubig sa manhole kaya binaha ang dalawang bahay. Nailikas ang pamilya sa covered court.",
        "triage": {"injuries": "no", "people_affected": "many", "detail": "rising_water"},
        "chat": [
            ("responder", "Papunta na po kami. Ilipat na po muna sa itaas ang mga gamit at appliances."),
            ("reporter", "Opo, tumataas pa po. Hanggang tuhod na po sa labas."),
            ("responder", "Nandito na po kami sa kanto. May dala kaming rescue boat."),
            ("responder", "Nailikas na po ang pamilya sa covered court. Ligtas po lahat."),
        ],
    },
    {
        "type": "fire",
        "status": "resolved",
        "hours_ago": 54,
        "assign": "resolved",
        "trail": ["submitted", "routing", "routed", "acknowledged", "en_route", "arrived", "resolved"],
        "place": "Ipil Street, second floor unit",
        "note": "Nagsimula sa kalan, naapula bago pa dumating ang BFP. Walang nasaktan.",
        "triage": {"injuries": "no", "detail": "contained"},
        "chat": [
            ("responder", "On the way po kami. Lumabas na po kayo ng bahay, huwag na pong balikan ang gamit."),
            ("reporter", "Nasa labas na po kami lahat. Naapula na po ng kapitbahay gamit ang extinguisher."),
            ("responder", "Nandito na po kami. Chineck po namin ang kusina, wala na pong apoy."),
        ],
    },
    {
        "type": "medical",
        "status": "resolved",
        "hours_ago": 41,
        "assign": "resolved",
        "trail": ["submitted", "routing", "routed", "acknowledged", "en_route", "arrived", "resolved"],
        "place": "Narra Street, near the sari-sari store",
        "note": "Nahilo at bumagsak ang lola, 78 anyos. Naihatid sa Amang Rodriguez.",
        "triage": {"injuries": "yes", "detail": "unconscious"},
        "chat": [
            ("responder", "BHW po ito, papunta na po kami. Huwag po muna galawin, ipahiga lang po nang maayos."),
            ("reporter", "Opo, humihinga naman po siya pero hindi sumasagot."),
            ("responder", "Nandito na po kami. Isinakay na po namin sa ambulansya papuntang Amang Rodriguez."),
        ],
    },
    {
        "type": "crime",
        "status": "closed",
        "hours_ago": 26,
        "assign": "resolved",
        "trail": ["submitted", "routing", "routed", "acknowledged", "arrived", "resolved", "closed"],
        "place": "Narra Street corner",
        "note": "Snatching ng cellphone. Naiturn-over sa Marikina PNP para sa blotter.",
        "triage": {"injuries": "no", "detail": "suspect_fled"},
        "chat": [
            ("responder", "Tanod po ito. Nasaan po kayo ngayon? Manatili po sa liwanag."),
            ("reporter", "Nasa tapat po ako ng tindahan. Tumakbo po siya papuntang Narra."),
            ("responder", "Nandito na po kami. Ipapa-blotter po natin sa Marikina PNP."),
        ],
    },
    {
        "type": "disaster",
        "status": "in_progress",
        "hours_ago": 5,
        "assign": "assisting",
        "trail": ["submitted", "routing", "routed", "acknowledged", "en_route", "arrived", "in_progress"],
        "place": "Creek easement behind Katipunan Street",
        "note": "Gumuho ang bahagi ng creek wall dahil sa habagat. Dalawang bahay ang apektado.",
        "triage": {"injuries": "no", "people_affected": "many", "detail": "structure_damage"},
        "chat": [
            ("responder", "BDRRMC po. Papunta na po kami, huwag po muna lumapit sa gumuhong bahagi."),
            ("reporter", "Opo. Lumalaki po yung bitak, natatakot po kami."),
            ("responder", "Nandito na po kami. Nag-cordon na po kami at tinatawagan na ang city engineer."),
        ],
    },
    {
        "type": "flood",
        "status": "en_route",
        "hours_ago": 2,
        "assign": "en_route",
        "trail": ["submitted", "routing", "routed", "acknowledged", "en_route"],
        "place": "Dao Street low-lying section",
        "note": "Mabilis ang pagtaas ng tubig, may mga nakatira sa unang palapag.",
        "triage": {"injuries": "no", "people_affected": "many", "detail": "rising_water"},
        "chat": [
            ("responder", "Papunta na po kami. Ihanda na po ang go-bag at ilipat sa itaas ang mahahalaga."),
            ("reporter", "Opo, hanggang bukong-bukong na po sa loob."),
        ],
    },
    {
        "type": "medical",
        "status": "acknowledged",
        "hours_ago": 1,
        "assign": "acknowledged",
        "trail": ["submitted", "routing", "routed", "acknowledged"],
        "place": "Jasmin Street",
        "note": "Nahulog sa hagdan, may sugat sa ulo pero gising at nakakausap.",
        "triage": {"injuries": "yes", "detail": "conscious"},
        "chat": [
            ("responder", "BHW po, papunta na po kami. Huwag po patayuin, gamitan po ng malinis na tela ang sugat."),
        ],
    },
    {
        "type": "crime",
        "status": "escalation_required",
        "hours_ago": 4,
        "assign": None,
        "trail": ["submitted", "routing", "escalation_required"],
        "place": "Apitong Street",
        "note": "Walang naka-duty na tanod nang mag-report. Kailangan ng manual dispatch.",
        "triage": {"injuries": "no", "detail": "attempted_break_in"},
        "chat": [],
    },
    {
        "type": "medical",
        "status": "submitted",
        "hours_ago": 0,
        "assign": None,
        "trail": ["submitted"],
        "place": "Dao Street, near the day-care",
        "note": "Kararating lang ng report, hindi pa naka-route.",
        "triage": {"injuries": "yes", "detail": "conscious"},
        "chat": [],
    },
    {
        "type": "fire",
        "status": "false_alarm",
        "hours_ago": 22,
        "assign": None,
        "trail": ["submitted", "routing", "routed", "false_alarm"],
        "place": "Katipunan Street",
        "note": "Usok mula sa sinunog na damo sa bakanteng lote. Hindi naman sunog.",
        "triage": {"injuries": "no"},
        "chat": [
            ("reporter", "Pasensya na po, usok lang po pala ng sinunog na damo. Hindi po sunog."),
        ],
    },
]


# ---------------------------------------------------------------------------
# Announcements. Real barangay notice types, Taglish where a barangay would use it.
# ---------------------------------------------------------------------------

ANNOUNCEMENTS = [
    {
        "title": "Yellow rainfall warning — habagat, ingat sa mga creek-side na bahay",
        "body": (
            "Nagtaas po ng yellow rainfall warning ang PAGASA para sa Marikina. Sa mga "
            "nakatira malapit sa creek sa Ipil Street at Dao: ihanda na po ang go-bag, "
            "i-charge ang cellphone, at ilipat sa itaas ang mahahalagang gamit.\n\n"
            "Bukas po ang covered court bilang evacuation area. Ang anunsyo ng paglikas ay "
            "ipapaalam dito sa app at sa text."
        ),
        "tag": "Weather",
        "urgency": "urgent",
        "days_ago": 0,
        "pinned": True,
        "photo": "river_works",
    },
    {
        "title": "Declogging ng kanal sa Champaca at Dao — Miyerkules",
        "body": (
            "Magsasagawa po ng declogging operations ang Infrastructure Committee sa "
            "Champaca at Dao Street sa Miyerkules, simula alas-otso ng umaga.\n\n"
            "Pakiusap po na alisin muna ang mga nakaparadang sasakyan sa tapat ng kanal. "
            "Salamat sa mga nag-report — dahil po sa inyong report kaya na-prioritize ito."
        ),
        "tag": "Public Works",
        "urgency": "important",
        "days_ago": 2,
        "pinned": True,
    },
    {
        "title": "Libreng anti-rabies vaccination para sa aso at pusa",
        "body": (
            "Sa Sabado po, alas-otso hanggang alas-dose ng tanghali sa covered court. "
            "Libre po ito. Dalhin ang aso o pusa na naka-tali o nasa carrier, at ang record "
            "book kung mayroon."
        ),
        "tag": "Health",
        "urgency": "normal",
        "days_ago": 4,
    },
    {
        "title": "Bagong schedule ng koleksyon ng basura: Martes at Biyernes",
        "body": (
            "Simula sa susunod na linggo, Martes at Biyernes na po ang koleksyon ng basura. "
            "Ilabas po bago mag-alas-sais ng umaga.\n\n"
            "Segregated lang po ang kinokolekta. Ang hindi nakabukod ay hindi po kukunin. "
            "Ang tamang segregation po ang isa sa pinakamalaking tulong laban sa baha."
        ),
        "tag": "Sanitation",
        "urgency": "normal",
        "days_ago": 7,
    },
    {
        "title": "Ordinansa sa ingay: hanggang alas-diyes ng gabi lamang ang videoke",
        "body": (
            "Paalala po sa lahat: ang videoke at malakas na sound system ay hanggang "
            "alas-diyes ng gabi lamang, alinsunod sa barangay ordinance.\n\n"
            "Ang paulit-ulit na paglabag ay maaaring dalhin sa Lupon Tagapamayapa. "
            "Magrespetuhan po tayo sa kapitbahay."
        ),
        "tag": "Peace and Order",
        "urgency": "important",
        "days_ago": 10,
    },
    {
        "title": "Barangay clearance, pwede na online i-request",
        "body": (
            "Pwede na po kayong mag-request ng barangay clearance dito sa app at kunin na "
            "lang sa hall kinabukasan. Magdala po ng valid ID pagkuha."
        ),
        "tag": "Services",
        "urgency": "normal",
        "days_ago": 13,
    },
    {
        "title": "Release ng pension ng senior citizens — ika-25 at 26",
        "body": (
            "Sa barangay hall po, ika-25 at 26 ng buwan. Dalhin po ang ID at booklet. "
            "Kung may kinatawan, kailangan po ng authorization letter at ID ng dalawa."
        ),
        "tag": "Social Services",
        "urgency": "normal",
        "days_ago": 16,
        "audience": "residents",
    },
]

EVENTS = [
    ("Barangay assembly", "Quarterly assembly sa covered court. Ulat sa badyet at flood control.", 3, 18),
    ("Clean-up drive sa creek easement", "Meet sa barangay hall. Magdala ng guwantes at sako.", 6, 6),
    ("Libreng medical check-up", "Konsulta at blood pressure screening sa health center.", 9, 8),
    ("Feeding program", "Para sa mga batang 3 hanggang 10 taong gulang sa day-care.", 12, 9),
    ("Fire at earthquake drill", "Kasama ang BFP at BDRRMC. Bukas sa lahat ng residente.", 15, 15),
    ("Basketball league opening", "Opening ceremony sa covered court.", 19, 16),
    ("Livelihood seminar", "Pagpaparehistro ng maliit na negosyo at micro-loans.", 23, 13),
    ("Tree planting sa creek easement", "Sa Ipil Street easement. Magdala ng pala.", 28, 7),
]
