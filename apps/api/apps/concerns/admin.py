from django.contrib import admin

from .models import (
    Announcement,
    BarangayEvent,
    Concern,
    ConcernAiAssessment,
    ConcernComment,
    ConcernMedia,
    ConcernStatusEvent,
    ConcernVote,
    ContentFlag,
)

admin.site.register(Concern)
admin.site.register(ConcernMedia)
admin.site.register(ConcernStatusEvent)
admin.site.register(ConcernVote)
admin.site.register(ConcernComment)
admin.site.register(ContentFlag)
admin.site.register(ConcernAiAssessment)
admin.site.register(Announcement)
admin.site.register(BarangayEvent)
