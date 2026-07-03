from rest_framework.routers import DefaultRouter
from .views import EmergencyAlertViewSet

router = DefaultRouter()
router.register("alerts", EmergencyAlertViewSet, basename="emergency-alert")
urlpatterns = router.urls
