from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from .models import (
    AccountRequest,
    AuditLog,
    ConsentRecord,
    OTPChallenge,
    ResidenceProof,
    ResidentProfile,
    ResidentSettings,
    User,
    VerificationCheck,
)


@admin.register(User)
class AccountUserAdmin(UserAdmin):
    model = User
    ordering = ("email",)
    list_display = ("email", "phone_number", "role", "status", "is_staff")
    list_filter = ("role", "status", "is_staff", "is_superuser")
    search_fields = ("email", "phone_number")
    fieldsets = (
        (None, {"fields": ("email", "password")}),
        ("Profile", {"fields": ("phone_number", "role", "status")}),
        ("Verification", {"fields": ("email_verified_at", "phone_verified_at")}),
        ("Permissions", {"fields": ("is_active", "is_staff", "is_superuser", "groups", "user_permissions")}),
        ("Important dates", {"fields": ("last_login", "date_joined")}),
    )
    add_fieldsets = (
        (None, {
            "classes": ("wide",),
            "fields": ("email", "phone_number", "password1", "password2", "role", "status", "is_staff", "is_superuser"),
        }),
    )


admin.site.register(ResidentProfile)
admin.site.register(ResidentSettings)
admin.site.register(AccountRequest)
admin.site.register(OTPChallenge)
admin.site.register(ResidenceProof)
admin.site.register(ConsentRecord)
admin.site.register(VerificationCheck)
admin.site.register(AuditLog)
