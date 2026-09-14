from django.contrib import admin

from .models import NativePushDevice, Notification


@admin.register(Notification)
class NotificationAdmin(admin.ModelAdmin):
    list_display = ["title", "type", "recipient", "concern", "emergency", "is_read", "created_at"]
    list_filter = ["type", "is_read", "created_at"]
    search_fields = ["title", "recipient__email", "concern__title", "emergency__id"]

@admin.register(NativePushDevice)
class NativePushDeviceAdmin(admin.ModelAdmin):
    list_display = ["user", "platform", "is_active", "updated_at"]
    list_filter = ["platform", "is_active"]
    search_fields = ["user__email", "token"]
