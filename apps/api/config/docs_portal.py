"""Documentation portal for the E-Boses API.

/api/docs/ renders Stoplight Elements (the same engine api.sms-gate.app uses):
sidebar navigation, request/response examples and live model schemas. The
classic Swagger UI stays available at /api/swagger/, and the raw OpenAPI
document is linked as doc.json in the top bar.
"""

import html

from django.conf import settings
from django.http import HttpResponse
from drf_spectacular.views import SpectacularSwaggerView

PORTAL_TEMPLATE = """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>E-Boses API documentation</title>
  <link rel="stylesheet" href="https://unpkg.com/@stoplight/elements/styles.min.css" />
  <script src="https://unpkg.com/@stoplight/elements/web-components.min.js" defer></script>
  <style>
    body {{ margin: 0; font-family: ui-sans-serif, system-ui, sans-serif; }}
    .topbar {{
      display: flex; align-items: center; justify-content: space-between;
      gap: 16px; padding: 10px 20px; border-bottom: 1px solid #e6e8eb;
      background: #ffffff; position: sticky; top: 0; z-index: 10;
    }}
    .brand {{ display: flex; align-items: center; gap: 10px; font-weight: 700; color: #17202e; }}
    .brand .badge {{
      background: #f2600c; color: #fff; border-radius: 6px;
      padding: 2px 8px; font-size: 12px; letter-spacing: .04em;
    }}
    .links {{ display: flex; flex-wrap: wrap; gap: 18px; font-size: 14px; }}
    .links a {{ color: #4070a0; text-decoration: none; }}
    .links a:hover {{ text-decoration: underline; }}
    elements-api {{ display: block; height: calc(100vh - 49px); }}
  </style>
</head>
<body>
  <div class="topbar">
    <div class="brand">E-Boses API <span class="badge">{version}</span></div>
    <nav class="links">
      <a href="{website_url}" target="_blank" rel="noopener">E-Boses Support - Website</a>
      <a href="mailto:{support_email}?subject=E-Boses%20API%20support">Send email to E-Boses Support</a>
      <a href="/api/schema/?format=json" target="_blank" rel="noopener">doc.json</a>
      <a href="/api/swagger/">Swagger UI</a>
    </nav>
  </div>
  <elements-api
    apiDescriptionUrl="/api/schema/?format=json"
    router="hash"
    layout="sidebar"
    tryItCredentialsPolicy="include"
  />
</body>
</html>
"""


def docs_portal(request):
    website_url = getattr(settings, "EBoses_WEBSITE_URL", "") or "https://example.com"
    support_email = getattr(settings, "SUPPORT_EMAIL", "") or "support@example.com"
    page = PORTAL_TEMPLATE.format(
        version=html.escape(getattr(settings, "API_VERSION", "1.0.0")),
        website_url=html.escape(website_url),
        support_email=html.escape(support_email),
    )
    return HttpResponse(page, content_type="text/html")


class SwaggerFallbackView(SpectacularSwaggerView):
    url_name = "api-schema"
