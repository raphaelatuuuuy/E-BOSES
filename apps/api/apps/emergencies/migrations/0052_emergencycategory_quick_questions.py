from django.db import migrations, models


COMMON_QUESTIONS = [
    {
        "key": "people_affected",
        "question": "How many people are affected?",
        "choices": [
            {"value": "one", "label": "Just 1"},
            {"value": "few", "label": "2–5"},
            {"value": "many", "label": "6 or more"},
            {"value": "unknown", "label": "Not sure"},
        ],
    },
    {
        "key": "injuries",
        "question": "Is anyone injured or trapped?",
        "choices": [
            {"value": "yes", "label": "Yes"},
            {"value": "no", "label": "No"},
            {"value": "unknown", "label": "Not sure"},
        ],
    },
]

DETAIL_QUESTIONS = {
    "fire": {
        "key": "detail",
        "question": "Is the fire still spreading?",
        "choices": [
            {"value": "spreading", "label": "Yes, spreading"},
            {"value": "contained", "label": "No, contained"},
        ],
    },
    "medical": {
        "key": "detail",
        "question": "Is the person conscious and breathing?",
        "choices": [
            {"value": "conscious", "label": "Yes"},
            {"value": "unconscious", "label": "No"},
        ],
    },
    "flood": {
        "key": "detail",
        "question": "How deep is the water?",
        "choices": [
            {"value": "ankle", "label": "Ankle deep"},
            {"value": "knee", "label": "Knee deep"},
            {"value": "waist", "label": "Waist or higher"},
        ],
    },
    "crime": {
        "key": "detail",
        "question": "Is the person still there?",
        "choices": [
            {"value": "present", "label": "Yes, still there"},
            {"value": "gone", "label": "No, left"},
        ],
    },
    "domestic_violence": {
        "key": "detail",
        "question": "Is anyone in immediate danger right now?",
        "choices": [
            {"value": "immediate_danger", "label": "Yes"},
            {"value": "no_immediate_danger", "label": "No"},
        ],
    },
    "child_protection": {
        "key": "detail",
        "question": "Is the child in immediate danger right now?",
        "choices": [
            {"value": "immediate_danger", "label": "Yes"},
            {"value": "no_immediate_danger", "label": "No"},
        ],
    },
    "disaster": {
        "key": "detail",
        "question": "Is anyone trapped?",
        "choices": [
            {"value": "trapped", "label": "Yes"},
            {"value": "not_trapped", "label": "No"},
        ],
    },
}


def default_questions(code):
    questions = [dict(question, choices=[dict(choice) for choice in question["choices"]]) for question in COMMON_QUESTIONS]
    detail = DETAIL_QUESTIONS.get(code)
    if detail:
        questions.append({**detail, "choices": [dict(choice) for choice in detail["choices"]]})
    return questions


def backfill_questions(apps, schema_editor):
    EmergencyCategory = apps.get_model("emergencies", "EmergencyCategory")
    for category in EmergencyCategory.objects.all():
        category.quick_questions = default_questions(category.code)
        category.save(update_fields=["quick_questions"])


class Migration(migrations.Migration):
    dependencies = [("emergencies", "0051_offline_sos_gateway_number")]

    operations = [
        migrations.AddField(
            model_name="emergencycategory",
            name="quick_questions",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.RunPython(backfill_questions, migrations.RunPython.noop),
    ]
