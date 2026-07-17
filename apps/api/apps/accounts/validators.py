import re

from django.core.exceptions import ValidationError
from django.utils.translation import gettext as _


class CharacterClassPasswordValidator:
    """Require the same password character classes enforced by the web UI."""

    checks = (
        (re.compile(r"[A-Z]"), _("Password must contain at least one uppercase letter.")),
        (re.compile(r"[a-z]"), _("Password must contain at least one lowercase letter.")),
        (re.compile(r"[0-9]"), _("Password must contain at least one number.")),
        (re.compile(r"[^A-Za-z0-9]"), _("Password must contain at least one special character.")),
    )

    def validate(self, password, user=None):
        errors = [message for pattern, message in self.checks if not pattern.search(password)]
        if errors:
            raise ValidationError(errors)

    def get_help_text(self):
        return _(
            "Your password must contain at least one uppercase letter, one lowercase letter, "
            "one number, and one special character."
        )
