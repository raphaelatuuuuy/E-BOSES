from django.db import migrations, models

# The standing barangay units, desks and committees, in the order an official
# would read them off an organisational chart: elected officials first, then
# mandated desks, then standing committees.
#
# Seeded rather than hardcoded so officials can rename, deactivate, add and
# remove units without a code change. `update_or_create` on `code` keeps this
# migration safe to re-run and non-destructive to any unit already renamed.
ROSTER = [
    ("captain", "Barangay Captain", "Captain",
     "Overall governance, escalated complaints, community issues",
     "Oversees emergency response and coordination"),
    ("secretary", "Barangay Secretary", "Secretary",
     "Records, documentation, certifications, complaint records",
     "Logs incidents and reports"),
    ("treasurer", "Barangay Treasurer", "Treasurer",
     "Financial concerns, fees, payments",
     "Limited emergency role"),
    ("sangguniang-barangay", "Sangguniang Barangay (Kagawads)", "Kagawads",
     "Assigned sectors such as health, environment, youth, peace and order",
     "Supports response within the assigned sector"),
    ("lupon-tagapamayapa", "Lupon Tagapamayapa", "Lupon",
     "Neighbour, family and property disputes, mediation",
     "Not emergency related"),
    ("bpso-tanod", "Barangay Public Safety Officer (BPSO) / Tanod", "Tanod",
     "Peace and order, disturbances, theft, curfew violations, suspicious activity",
     "Crime response, crowd control, first responder"),
    ("bhw", "Barangay Health Workers (BHW)", "BHW",
     "Health concerns, medical assistance, vaccinations, disease monitoring",
     "Medical emergencies"),
    ("bns", "Barangay Nutrition Scholar (BNS)", "BNS",
     "Nutrition programmes, malnutrition concerns",
     "Supports health emergencies involving children"),
    ("bdrrmo", "BDRRMC / BDRRMO", "BDRRMO",
     "Flooding, typhoons, earthquakes, rescue operations",
     "Disaster emergencies"),
    ("badac", "Barangay Anti-Drug Abuse Council (BADAC)", "BADAC",
     "Drug-related complaints, awareness, rehabilitation referrals",
     "Drug-related incidents"),
    ("bcpc", "Barangay Council for the Protection of Children (BCPC)", "BCPC",
     "Child abuse, neglected children, child welfare concerns",
     "Child protection emergencies"),
    ("vawc-desk", "VAWC Desk", "VAWC",
     "Violence against women and children cases",
     "Domestic violence emergencies"),
    ("senior-citizens-desk", "Senior Citizens Affairs Desk", "Senior Citizens",
     "Concerns involving senior citizens",
     "Welfare and medical coordination"),
    ("pwd-desk", "PWD Affairs Desk", "PWD Affairs",
     "Concerns involving persons with disabilities",
     "Welfare and accessibility emergencies"),
    ("sk", "Sangguniang Kabataan (SK)", "SK",
     "Youth-related concerns and youth programmes",
     "Youth volunteer assistance"),
    ("environment-sanitation", "Environmental and Sanitation Committee", "Sanitation",
     "Garbage, illegal dumping, drainage, pollution, sanitation",
     "Environmental hazards"),
    ("infrastructure-public-works", "Infrastructure / Public Works Committee", "Public Works",
     "Roads, streetlights, sidewalks, drainage, public facilities",
     "Infrastructure-related hazards"),
    ("peace-and-order", "Peace and Order Committee", "Peace & Order",
     "Crime prevention, community safety",
     "Security emergencies"),
    ("education-committee", "Education Committee", "Education",
     "Community education concerns",
     "Limited emergency role"),
    ("social-services", "Social Services Committee", "Social Services",
     "Financial aid referrals, welfare assistance",
     "Relief operations during disasters"),
]


def seed_roster(apps, schema_editor):
    Department = apps.get_model("concerns", "Department")
    for index, (code, name, short_name, description, emergency_role) in enumerate(ROSTER):
        Department.objects.update_or_create(
            code=code,
            defaults={
                "name": name,
                "short_name": short_name,
                "description": description,
                "emergency_role": emergency_role,
                "sort_order": index,
                "is_active": True,
            },
        )


def unseed_roster(apps, schema_editor):
    """Remove only the seeded rows that nothing depends on.

    A unit an official has since assigned work to is left alone: reversing a
    migration should not detach concern history.
    """
    Department = apps.get_model("concerns", "Department")
    codes = [row[0] for row in ROSTER]
    Department.objects.filter(code__in=codes, concerns__isnull=True).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("concerns", "0024_concerncategory_department_position_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="department",
            name="short_name",
            field=models.CharField(blank=True, max_length=48),
        ),
        migrations.AddField(
            model_name="department",
            name="emergency_role",
            field=models.CharField(blank=True, max_length=255),
        ),
        migrations.AddField(
            model_name="department",
            name="sort_order",
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AlterModelOptions(
            name="department",
            options={"ordering": ["sort_order", "name"]},
        ),
        migrations.RunPython(seed_roster, unseed_roster),
    ]
