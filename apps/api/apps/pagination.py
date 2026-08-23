"""Envelope pagination for plain APIView list endpoints.

DRF's DEFAULT_PAGINATION_CLASS never fires on hand-rolled APIViews, so every
list endpoint here returns the whole table. paginate_response slices the
queryset BEFORE serializing and answers with {count, next, previous, results}.
The web client unwraps `results` (apps/web/src/lib/api.ts unwrapList).
"""

from urllib.parse import urlencode

from rest_framework.response import Response

DEFAULT_PAGE_SIZE = 50
MAX_PAGE_SIZE = 100


def _page_params(request):
    try:
        page = max(1, int(request.query_params.get("page", 1)))
    except (TypeError, ValueError):
        page = 1
    try:
        size = int(request.query_params.get("page_size", DEFAULT_PAGE_SIZE))
    except (TypeError, ValueError):
        size = DEFAULT_PAGE_SIZE
    return page, min(max(1, size), MAX_PAGE_SIZE)


def _page_url(request, page, size):
    params = request.query_params.copy()
    params["page"] = page
    params["page_size"] = size
    base = request.build_absolute_uri().split("?")[0]
    return f"{base}?{urlencode(params)}"


def paginate_response(request, queryset, serialize_page):
    """Serialize only the current page.

    serialize_page receives an ordered, already-sliced queryset iterable and
    must return a list of JSON-ready dicts.
    """
    page, size = _page_params(request)
    total = queryset.count()
    start = (page - 1) * size
    results = serialize_page(queryset[start:start + size])
    return Response(
        {
            "count": total,
            "next": _page_url(request, page + 1, size) if start + size < total else None,
            "previous": _page_url(request, page - 1, size) if page > 1 else None,
            "results": results,
        }
    )
