"""Shared OpenAPI building blocks so hand-rolled APIViews document well.

drf-spectacular can only infer schemas from serializer references; these
helpers give the manual list endpoints accurate envelope responses, page
query parameters and example payloads in one place.
"""

from drf_spectacular.utils import OpenApiExample, OpenApiParameter, OpenApiResponse, inline_serializer
from rest_framework import serializers

PAGE_PARAMETERS = [
    OpenApiParameter(
        name="page",
        type=int,
        location=OpenApiParameter.QUERY,
        description="1-based page number. Defaults to 1.",
    ),
    OpenApiParameter(
        name="page_size",
        type=int,
        location=OpenApiParameter.QUERY,
        description="Rows per page. Defaults to 50, capped at 100.",
    ),
]


def list_envelope_response(item_serializer, *, name: str, description: str = "") -> OpenApiResponse:
    """The {count, next, previous, results} shape every manual list returns."""
    return OpenApiResponse(
        response=inline_serializer(
            name=name,
            fields={
                "count": serializers.IntegerField(help_text="Total rows across all pages."),
                "next": serializers.URLField(allow_null=True, help_text="URL of the next page or null."),
                "previous": serializers.URLField(allow_null=True, help_text="URL of the previous page or null."),
                "results": item_serializer(many=True),
            },
        ),
        description=description or "Paginated envelope. Use ?page and ?page_size (max 100).",
    )


def error_response(description: str = "Validation or permission problem.") -> OpenApiResponse:
    return OpenApiResponse(description=description)


def bearer_auth_example() -> OpenApiExample:
    return OpenApiExample(
        name="Authenticated call",
        description="Send the access token from /api/auth/login/ as a Bearer token.",
        value={"Authorization": "Bearer <access-token>"},
    )
