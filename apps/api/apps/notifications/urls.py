from rest_framework.routers import DefaultRouter
from .views import DeviceTokenViewSet, NotificationViewSet

router = DefaultRouter()
router.register("device-tokens", DeviceTokenViewSet, basename="device-token")
router.register("", NotificationViewSet, basename="notification")
urlpatterns = router.urls
