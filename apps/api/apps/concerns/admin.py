"""Admin surfaces advisory AI scores while preserving reviewer authority."""

from django.contrib import admin

from .models import Category, Concern, ConcernMedia, ConcernStatusLog


@admin.register(Category)
class CategoryAdmin(admin.ModelAdmin):
    list_display = ("name", "is_active", "created_at")
    search_fields = ("name",)


class ConcernMediaInline(admin.TabularInline):
    model = ConcernMedia
    extra = 0


@admin.register(Concern)
class ConcernAdmin(admin.ModelAdmin):
    list_display = ("title", "status", "ai_severity_score", "ai_relevance_score", "ai_fake_report_score", "ai_category_suggestion", "reviewer", "created_at")
    list_filter = ("status", "category", "reviewer_category")
    search_fields = ("title", "description", "ai_explanation")
    readonly_fields = ("ai_severity_score", "ai_category_suggestion", "ai_relevance_score", "ai_fake_report_score", "ai_model_version", "ai_explanation", "ai_metadata", "ai_reviewed_at", "created_at", "updated_at")
    inlines = [ConcernMediaInline]


@admin.register(ConcernStatusLog)
class ConcernStatusLogAdmin(admin.ModelAdmin):
    list_display = ("concern", "status", "actor", "created_at")
    list_filter = ("status",)
