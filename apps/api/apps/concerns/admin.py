from django.contrib import admin
from .models import ConcernCategory, ConcernMedia, ConcernReport, ConcernStatusHistory, ConcernVote

admin.site.register(ConcernCategory)
admin.site.register(ConcernReport)
admin.site.register(ConcernMedia)
admin.site.register(ConcernVote)
admin.site.register(ConcernStatusHistory)
