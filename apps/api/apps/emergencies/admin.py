from django.contrib import admin

from .models import (
    EmergencyAlert,
    EmergencyAppeal,
    EmergencyEscalation,
    EmergencyLocationPing,
    EmergencyMedia,
    EmergencyResponderAssignment,
    EmergencyStatusEvent,
    WitnessNotification,
)


admin.site.register(EmergencyAlert)
admin.site.register(EmergencyAppeal)
admin.site.register(EmergencyEscalation)
admin.site.register(EmergencyMedia)
admin.site.register(EmergencyResponderAssignment)
admin.site.register(EmergencyLocationPing)
admin.site.register(EmergencyStatusEvent)
admin.site.register(WitnessNotification)
