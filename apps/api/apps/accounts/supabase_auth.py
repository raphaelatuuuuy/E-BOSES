import uuid

import jwt
from django.conf import settings
from django.db import transaction
from rest_framework.authentication import BaseAuthentication, get_authorization_header
from rest_framework.exceptions import AuthenticationFailed

from .models import User


class SupabaseJWTAuthentication(BaseAuthentication):
    keyword = b"Bearer"

    def authenticate(self, request):
        parts = get_authorization_header(request).split()
        if not parts:
            return None
        if len(parts) != 2 or parts[0].lower() != self.keyword.lower():
            raise AuthenticationFailed("Invalid authorization header.")

        token = parts[1].decode("utf-8")
        claims = self._decode(token)
        try:
            subject = uuid.UUID(claims["sub"])
        except (KeyError, TypeError, ValueError) as exc:
            raise AuthenticationFailed("Token has no valid subject.") from exc

        user = User.objects.filter(supabase_user_id=subject).first()
        if not user and settings.SUPABASE_AUTO_LINK_USERS:
            user = self._link_existing_user(subject, claims)
        if not user:
            raise AuthenticationFailed("This Supabase account is not linked to an E-Boses user.")
        if not user.is_active:
            raise AuthenticationFailed("This account is inactive.")
        return user, claims

    @staticmethod
    def _decode(token):
        issuer = f"{settings.SUPABASE_URL}/auth/v1"
        options = {"require": ["exp", "iat", "sub", "aud"]}
        try:
            header = jwt.get_unverified_header(token)
            algorithm = header.get("alg", "")
            if algorithm == "HS256" and settings.SUPABASE_JWT_SECRET:
                key = settings.SUPABASE_JWT_SECRET
            elif algorithm in {"ES256", "RS256"}:
                jwks = jwt.PyJWKClient(f"{issuer}/.well-known/jwks.json", cache_keys=True)
                key = jwks.get_signing_key_from_jwt(token).key
            else:
                raise AuthenticationFailed("Unsupported Supabase token algorithm.")
            return jwt.decode(
                token,
                key,
                algorithms=[algorithm],
                audience=settings.SUPABASE_JWT_AUDIENCE,
                issuer=issuer,
                options=options,
            )
        except AuthenticationFailed:
            raise
        except jwt.PyJWTError as exc:
            raise AuthenticationFailed("Invalid or expired Supabase token.") from exc

    @staticmethod
    def _link_existing_user(subject, claims):
        email = (claims.get("email") or "").strip().lower()
        if not email:
            return None
        with transaction.atomic():
            user = User.objects.select_for_update().filter(email__iexact=email).first()
            if not user or user.supabase_user_id:
                return None
            user.supabase_user_id = subject
            user.save(update_fields=["supabase_user_id"])
            return user
