from django.contrib import admin

from .models import (
    EmergencyAlert,
    EmergencyAppeal,
    EmergencyEscalation,
    EmergencyLocationPing,
    EmergencyMedia,
    EmergencyResponderAssignment,
    EmergencyStatusEvent,
    MapGeometry,
    WitnessNotification,
)


admin.site.register(EmergencyAlert)
admin.site.register(EmergencyAppeal)
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


admin.site.register(WitnessNotification)
