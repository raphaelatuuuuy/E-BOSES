from django.contrib import admin
from .models import AlertAcknowledgement, EmergencyAlert, EmergencyStatusHistory

admin.site.register(EmergencyAlert)
admin.site.register(AlertAcknowledgement)
admin.site.register(EmergencyStatusHistory)
