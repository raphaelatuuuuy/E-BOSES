"""OpenAPI post-processing: shared error contract and payload fallbacks.

Hand-rolled APIViews answer with plain ``Response(...)`` payloads the schema
generator cannot see, which left Swagger UI showing "No response body" on most
operations. This hook:

1. Documents the shared error contract — a reusable ``Error`` schema with
   concrete examples — as 401/403 on authenticated operations and 500 on all
   of them, mirroring the Responses section of the reference docs.
2. Gives success responses that carry no documented body an honest generic
   JSON shape (paginated envelope where ``page`` is a query param, otherwise
   an object/array union) so every operation renders Example Value / Model
   tabs instead of an empty response.
"""

ERROR_SCHEMA = "Error"
ENVELOPE_SCHEMA = "PaginatedListEnvelope"
HTTP_METHODS = {"get", "post", "put", "patch", "delete"}


def _error_response(description: str, example: str) -> dict:
    return {
        "description": description,
        "content": {
            "application/json": {
                "schema": {"$ref": f"#/components/schemas/{ERROR_SCHEMA}"},
                "examples": {
                    "default": {"summary": "Error body", "value": {"detail": example}}
                },
            }
        },
    }


def _has_page_param(operation: dict, components: dict) -> bool:
    for param in operation.get("parameters", []) or []:
        if not isinstance(param, dict):
            continue
        if param.get("name") == "page":
            return True
        if "$ref" in param:
            ref_name = param["$ref"].rsplit("/", 1)[-1]
            resolved = (components.get("parameters") or {}).get(ref_name) or {}
            if resolved.get("name") == "page":
                return True
    return False


def _generic_payload(has_page: bool) -> dict:
    if has_page:
        schema: dict = {"$ref": f"#/components/schemas/{ENVELOPE_SCHEMA}"}
    else:
        item = {
            "type": "object",
            "additionalProperties": True,
            "description": "Any JSON object.",
        }
        schema = {
            "oneOf": [
                item,
                {
                    "type": "array",
                    "items": item,
                    "description": "A plain JSON list.",
                },
            ],
            "description": (
                "JSON payload produced by a hand-rolled view: an object for "
                "single resources and action endpoints, a list for plain lists."
            ),
        }
    return {"application/json": {"schema": schema}}


def add_standard_responses(result, generator, request, public):
    """drf-spectacular POSTPROCESSING_HOOK: enrich every operation."""
    components = result.setdefault("components", {}).setdefault("schemas", {})
    components.setdefault(
        ERROR_SCHEMA,
        {
            "type": "object",
            "required": ["detail"],
            "properties": {
                "detail": {
                    "type": "string",
                    "description": "Human-readable explanation of what went wrong.",
                }
            },
        },
    )
    components.setdefault(
        ENVELOPE_SCHEMA,
        {
            "type": "object",
            "required": ["count", "results"],
            "properties": {
                "count": {
                    "type": "integer",
                    "example": 42,
                    "description": "Total items across every page.",
                },
                "next": {
                    "type": "string",
                    "nullable": True,
                    "description": "URL of the next page, or null.",
                },
                "previous": {
                    "type": "string",
                    "nullable": True,
                    "description": "URL of the previous page, or null.",
                },
                "results": {
                    "type": "array",
                    "items": {"type": "object", "additionalProperties": True},
                },
            },
        },
    )

    errors = {
        "401": _error_response(
            "Missing or expired access token.",
            "Authentication credentials were not provided.",
        ),
        "403": _error_response(
            "Authenticated, but not allowed to perform this action.",
            "You do not have permission to perform this action.",
        ),
        "500": _error_response(
            "Unexpected server error. The incident is logged for support.",
            "Internal server error.",
        ),
    }

    for item in result.get("paths", {}).values():
        for method, operation in item.items():
            if method not in HTTP_METHODS or not isinstance(operation, dict):
                continue
            responses = operation.setdefault("responses", {})
            # drf-spectacular marks anonymous operations with security: [{}]
            # (an empty requirement); real auth produces non-empty entries.
            authenticated = any(
                bool(requirement)
                for requirement in (operation.get("security") or [])
                if isinstance(requirement, dict)
            )
            for code in ("401", "403"):
                if authenticated and code not in responses:
                    responses[code] = errors[code]
            responses.setdefault("500", errors["500"])

            for code, response in responses.items():
                if not str(code).startswith("2") or code == "204":
                    continue
                if response.get("content"):
                    continue
                response["content"] = _generic_payload(
                    _has_page_param(operation, components)
                )
    return result
