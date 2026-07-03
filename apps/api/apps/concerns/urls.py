from rest_framework.routers import DefaultRouter
from .views import ConcernCategoryViewSet, ConcernMediaViewSet, ConcernReportViewSet

router = DefaultRouter()
router.register("categories", ConcernCategoryViewSet, basename="concern-category")
router.register("reports", ConcernReportViewSet, basename="concern-report")
router.register("media", ConcernMediaViewSet, basename="concern-media")
urlpatterns = router.urls
