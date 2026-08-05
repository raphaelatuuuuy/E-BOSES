from django.urls import path

from .views import SmsInboundView

urlpatterns = [
    path("inbound/", SmsInboundView.as_view(), name="sms-inbound"),
    # Same view without the trailing slash. Django's APPEND_SLASH cannot
    # redirect a POST without discarding the body, so a gateway configured
    # without the slash would 500 on every emergency. A handset typo must not
    # be able to take emergency intake down.
    path("inbound", SmsInboundView.as_view(), name="sms-inbound-no-slash"),
]
