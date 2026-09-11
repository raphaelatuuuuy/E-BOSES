def handle(inbound, command, match, role):
    from apps.sms.router import Reply
    return Reply(None)
