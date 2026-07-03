from django.urls import path

from .views import (
    AdminCreateUserView,
    LoginView,
    MeView,
    OTPResendView,
    OTPVerifyView,
    PasswordResetConfirmView,
    PasswordResetRequestView,
    PasswordResetVerifyView,
    PhoneOTPRequestView,
    PhoneOTPVerifyView,
    RegisterView,
)

urlpatterns = [
    path("register/", RegisterView.as_view(), name="auth-register"),
    path("register/phone-otp/request/", PhoneOTPRequestView.as_view(), name="auth-phone-otp-request"),
    path("register/phone-otp/verify/", PhoneOTPVerifyView.as_view(), name="auth-phone-otp-verify"),
    path("login/", LoginView.as_view(), name="auth-login"),
    path("me/", MeView.as_view(), name="auth-me"),
    path("otp/resend/", OTPResendView.as_view(), name="auth-otp-resend"),
    path("otp/verify/", OTPVerifyView.as_view(), name="auth-otp-verify"),
    path("password-reset/request/", PasswordResetRequestView.as_view(), name="auth-password-reset-request"),
    path("password-reset/verify/", PasswordResetVerifyView.as_view(), name="auth-password-reset-verify"),
    path("password-reset/confirm/", PasswordResetConfirmView.as_view(), name="auth-password-reset-confirm"),
    path("admin/users/", AdminCreateUserView.as_view(), name="auth-admin-create-user"),
]
