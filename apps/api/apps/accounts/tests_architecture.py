"""Import-boundary checks for backend architecture conventions."""

import ast
from pathlib import Path

from django.test import SimpleTestCase

API_ROOT = Path(__file__).resolve().parents[2]
APP_ROOT = API_ROOT / "apps"
DOMAIN_APPS = ("accounts", "concerns", "emergencies", "notifications")


class ArchitectureBoundaryTests(SimpleTestCase):
    def test_domain_apps_expose_service_selector_and_adapter_modules(self):
        for app_name in DOMAIN_APPS:
            app_dir = APP_ROOT / app_name
            self.assertTrue((app_dir / "services.py").exists(), f"{app_name} should expose service functions")
            self.assertTrue((app_dir / "selectors.py").exists(), f"{app_name} should expose query selectors")
            self.assertTrue((app_dir / "adapters.py").exists(), f"{app_name} should define integration adapters")

    def test_views_do_not_import_cross_app_models(self):
        for view_path in APP_ROOT.glob("*/views.py"):
            tree = ast.parse(view_path.read_text(encoding="utf-8"), filename=str(view_path))
            current_app = view_path.parent.name
            for node in ast.walk(tree):
                if not isinstance(node, ast.ImportFrom) or not node.module:
                    continue
                for app_name in DOMAIN_APPS:
                    forbidden = f"apps.{app_name}.models"
                    if app_name != current_app and node.module == forbidden:
                        self.fail(f"{view_path} imports cross-app models from {forbidden}; use selectors/services")
