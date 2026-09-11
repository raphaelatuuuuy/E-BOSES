def status_text(alert):
    from apps.emergencies.vocabulary import heading, key_for_status
    return heading(key_for_status(alert.status), alert.status.replace("_", " "))


def status_body(alert):
    return ""


def handle(inbound, command, match):
    from apps.sms.router import Reply
    return Reply(None)
