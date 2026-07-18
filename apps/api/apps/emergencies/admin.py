from django.contrib import admin

from .models import (
    EmergencyAlert,
    EmergencyAppeal,
    EmergencyChatMessage,
    EmergencyEscalation,
    EmergencyLocationPing,
    EmergencyMedia,
    EmergencyResponderAssignment,
    EmergencyStatusEvent,
    MapGeometry,
    MapServicePoi,
    WitnessNotification,
)


admin.site.register(EmergencyAlert)
admin.site.register(EmergencyAppeal)
admin.site.register(EmergencyChatMessage)
admin.site.register(EmergencyEscalation)
admin.site.register(EmergencyMedia)
admin.site.register(EmergencyResponderAssignment)
admin.site.register(EmergencyLocationPing)
admin.site.register(EmergencyStatusEvent)


@admin.register(MapGeometry)
class MapGeometryAdmin(admin.ModelAdmin):
    list_display = ("name", "kind", "osm_type", "osm_id", "street_type", "is_active", "updated_at")
    list_filter = ("kind", "street_type", "is_active")
    search_fields = ("name",)


@admin.register(MapServicePoi)
class MapServicePoiAdmin(admin.ModelAdmin):
    list_display = (
        "name",
        "poi_type",
        "sector",
        "source",
        "latitude",
        "longitude",
        "osm_id",
        "is_active",
        "priority",
        "updated_at",
    )
    list_filter = ("poi_type", "sector", "source", "is_active")
    search_fields = ("name", "label", "notes")
    list_editable = ("is_active", "priority")
    readonly_fields = ("created_at", "updated_at")
    fieldsets = (
        (
            None,
            {
                "fields": (
                    "name",
                    "poi_type",
                    "label",
                    "sector",
                    "latitude",
                    "longitude",
                    "is_active",
                    "priority",
                    "notes",
                )
            },
        ),
        (
            "OpenStreetMap link (optional)",
            {
                "description": (
                    "Set OSM type + id to replace that feature when active, "
                    "or hide it when inactive. Leave blank for pure admin pins "
                    "(e.g. tanod outposts not in OSM)."
                ),
                "fields": ("source", "osm_type", "osm_id"),
            },
        ),
        ("Timestamps", {"fields": ("created_at", "updated_at")}),
    )


admin.site.register(WitnessNotification)
