from django.contrib import admin
from .models import DeviceToken, Notification, WitnessNotification

admin.site.register(Notification)
admin.site.register(WitnessNotification)
admin.site.register(DeviceToken)
