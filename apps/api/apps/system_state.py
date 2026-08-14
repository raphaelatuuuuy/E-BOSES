"""Whole-system state that several apps need to ask about.

Exists so a view never reaches across into another app's models for something
as small as "are we in maintenance right now".
"""


def maintenance_notice():
    """The live maintenance banner, or None."""
    from apps.concerns.models import SystemBanner

    return SystemBanner.live(SystemBanner.Kind.MAINTENANCE)


def ticker_notice():
    from apps.concerns.models import SystemBanner

    return SystemBanner.live(SystemBanner.Kind.TICKER)


def maintenance_blocks(user):
    """True when this user must be kept out while maintenance is on."""
    notice = maintenance_notice()
    if notice is None:
        return None
    if getattr(user, "is_staff", False) or getattr(user, "is_superuser", False):
        return None
    return notice
