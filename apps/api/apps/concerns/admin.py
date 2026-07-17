from django.contrib import admin

from .models import (
    Announcement,
    BarangayEvent,
    Concern,
    ConcernAppeal,
    ConcernAssignment,
    ConcernAiAssessment,
    ConcernClarification,
    ConcernComment,
    ConcernMedia,
    ConcernOfficialRemark,
    ConcernStatusEvent,
    ConcernVote,
    ContentFlag,
)

admin.site.register(Concern)
admin.site.register(ConcernAssignment)
admin.site.register(ConcernClarification)
admin.site.register(ConcernAppeal)
admin.site.register(ConcernOfficialRemark)
admin.site.register(ConcernMedia)
admin.site.register(ConcernStatusEvent)
admin.site.register(ConcernVote)
admin.site.register(ConcernComment)
admin.site.register(ContentFlag)
admin.site.register(ConcernAiAssessment)
admin.site.register(Announcement)
admin.site.register(BarangayEvent)
