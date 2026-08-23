from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from .models import (
    AccountRequest,
    AuditLog,
    ConsentRecord,
    DataSubjectRequest,
    OCRConfigurationVersion,
    OCRDocumentType,
    OCRFieldDefinition,
    OCRRule,
    OCRSample,
    OCRServiceStatus,
    OCRTestRun,
    OTPChallenge,
    ResidenceProof,
    ResidenceVerificationCase,
    ResidentProfile,
    ResidentSettings,
    User,
    VerificationCheck,
)


@admin.register(DataSubjectRequest)
class DataSubjectRequestAdmin(admin.ModelAdmin):
    list_display = ("user", "kind", "status", "requested_at", "processed_at")
    list_filter = ("kind", "status")
    search_fields = ("user__email",)
    readonly_fields = ("user", "kind", "requested_at", "processed_at", "processed_by")
    actions = ("approve_and_erase", "decline_request")

    @admin.action(description="Approve and erase resident data")
    def approve_and_erase(self, request, queryset):
        from apps.retention import process_data_subject_request_task
        from django.db import transaction

        for dsr in queryset.filter(status=DataSubjectRequest.Status.PENDING).select_related("user"):
            dsr.status = DataSubjectRequest.Status.APPROVED
            dsr.processed_by = request.user
            dsr.save(update_fields=["status", "processed_by"])
            transaction.on_commit(lambda dsr_id=dsr.pk: process_data_subject_request_task.delay(dsr_id))
        self.message_user(request, "Approved requests queued for erasure.")

    @admin.action(description="Decline request")
    def decline_request(self, request, queryset):
        updated = queryset.filter(status=DataSubjectRequest.Status.PENDING).update(
            status=DataSubjectRequest.Status.DECLINED
        )
        self.message_user(request, f"{updated} request(s) declined.")


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


@admin.register(OCRConfigurationVersion)
class OCRConfigurationVersionAdmin(admin.ModelAdmin):
    list_display = ("scope", "version", "status", "revision", "published_at", "updated_at")
    list_filter = ("scope", "status")
    search_fields = ("scope", "notes")
    readonly_fields = ("created_at", "updated_at", "published_at")


@admin.register(OCRDocumentType)
class OCRDocumentTypeAdmin(admin.ModelAdmin):
    list_display = ("name", "code", "configuration", "category", "enabled", "display_order")
    list_filter = ("enabled", "category", "configuration__status")
    search_fields = ("name", "code", "description")
    ordering = ("configuration", "display_order", "name")


@admin.register(OCRFieldDefinition)
class OCRFieldDefinitionAdmin(admin.ModelAdmin):
    list_display = ("label", "code", "document_type", "data_type", "required", "enabled", "min_confidence")
    list_filter = ("data_type", "required", "enabled")
    search_fields = ("label", "code", "document_type__name")


@admin.register(OCRRule)
class OCRRuleAdmin(admin.ModelAdmin):
    list_display = ("name", "code", "configuration", "document_type", "rule_type", "enabled", "on_failure")
    list_filter = ("rule_type", "operator", "on_failure", "enabled")
    search_fields = ("name", "code", "document_type__name")


@admin.register(OCRSample)
class OCRSampleAdmin(admin.ModelAdmin):
    list_display = ("name", "document_type", "is_synthetic", "is_active", "created_at")
    list_filter = ("is_synthetic", "is_active")
    search_fields = ("name", "document_type__name", "original_filename")


@admin.register(OCRServiceStatus)
class OCRServiceStatusAdmin(admin.ModelAdmin):
    list_display = ("provider", "status", "circuit_state", "consecutive_failures", "last_checked_at")
    list_filter = ("status", "circuit_state")
    readonly_fields = ("updated_at",)


@admin.register(ResidenceVerificationCase)
class ResidenceVerificationCaseAdmin(admin.ModelAdmin):
    list_display = ("user", "document_type", "status", "review_reason", "decision_source", "updated_at")
    list_filter = ("status", "review_reason", "decision_source", "retry_eligible")
    search_fields = ("user__email", "decision_reason")
    readonly_fields = ("created_at", "updated_at")


@admin.register(OCRTestRun)
class OCRTestRunAdmin(admin.ModelAdmin):
    list_display = ("id", "document_type", "status", "ocr_confidence", "requested_by", "created_at")
    list_filter = ("status", "document_type")
    search_fields = ("original_filename", "provider_job_id", "requested_by__email")
    readonly_fields = ("created_at", "updated_at")
