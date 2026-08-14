from unittest.mock import patch

from django.core.cache import cache
from django.test import TestCase, override_settings
from django.urls import reverse

from . import knowledge, services
from .client import AssistantUnavailable


class AssistantTopicsTests(TestCase):
    def test_topics_are_public(self):
        response = self.client.get(reverse("assistant-topics"))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["greeting"], knowledge.GREETING)

    def test_topic_ids_match_the_widget_defaults(self):
        response = self.client.get(reverse("assistant-topics"))
        ids = [topic["id"] for topic in response.json()["topics"]]
        self.assertEqual(
            ids,
            [
                "create-account",
                "report-concern",
                "how-it-works",
                "login-problem",
                "contact-support",
            ],
        )

    def test_every_chip_icon_is_known_to_the_frontend(self):
        known = {
            "user-plus",
            "megaphone",
            "info",
            "lock",
            "headset",
            "list",
            "badge-check",
            "shield",
            "users",
            "siren",
            "list-checks",
            "copy",
            "message-square",
            "globe",
        }
        for chip in knowledge.CHIPS.values():
            self.assertIn(chip["icon"], known)


@override_settings(ASSISTANT_ENABLED=False)
class AssistantAskTests(TestCase):
    def setUp(self):
        cache.clear()

    def ask(self, **payload):
        payload.setdefault("session_id", "session-under-test")
        return self.client.post(
            reverse("assistant-ask"), payload, content_type="application/json"
        )

    def test_known_topic_answers_from_rules_without_the_model(self):
        response = self.ask(topic_id="create-account", message="")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["source"], "rules")
        self.assertIn("sign-up page", body["reply"])
        self.assertTrue(body["suggestions"])

    def test_empty_payload_is_rejected(self):
        response = self.ask(message="", topic_id="")
        self.assertEqual(response.status_code, 400)

    def test_unknown_topic_with_no_message_falls_back(self):
        response = self.ask(topic_id="does-not-exist")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["source"], "fallback")

    def test_keyword_match_answers_from_rules_when_model_is_off(self):
        response = self.ask(message="paano ako mag sign up?")
        body = response.json()
        self.assertEqual(body["source"], "rules")
        self.assertIn("five minutes", body["reply"])

    def test_reply_never_contains_markdown(self):
        for topic_id in knowledge.ANSWERS:
            reply = knowledge.ANSWERS[topic_id]["reply"]
            self.assertNotIn("**", reply)
            self.assertNotIn("#", reply)
            self.assertNotIn("](", reply)

    @override_settings(
        ASSISTANT_ENABLED=True,
        ASSISTANT_API_KEY="test-key",
        ASSISTANT_BASE_URL="https://example.invalid/v1",
        ASSISTANT_MODEL="test-model",
    )
    def test_model_reply_is_stripped_of_markdown(self):
        with patch(
            "apps.assistant.services.complete",
            return_value="**Bold** and `code` and [link](http://x)",
        ):
            response = self.ask(message="tell me something new about the app")
        body = response.json()
        self.assertEqual(body["source"], "model")
        self.assertEqual(body["reply"], "Bold and code and link")

    @override_settings(
        ASSISTANT_ENABLED=True,
        ASSISTANT_API_KEY="test-key",
        ASSISTANT_BASE_URL="https://example.invalid/v1",
        ASSISTANT_MODEL="test-model",
    )
    def test_provider_outage_falls_back_to_rules(self):
        with patch(
            "apps.assistant.services.complete",
            side_effect=AssistantUnavailable("down"),
        ):
            response = self.ask(message="I forgot my password")
        body = response.json()
        self.assertEqual(body["source"], "rules")
        self.assertIn("reset option", body["reply"])

    @override_settings(
        ASSISTANT_ENABLED=True,
        ASSISTANT_API_KEY="test-key",
        ASSISTANT_BASE_URL="https://example.invalid/v1",
        ASSISTANT_MODEL="test-model",
        ASSISTANT_SESSION_BUDGET=2,
    )
    def test_session_budget_returns_429_with_a_readable_detail(self):
        with patch("apps.assistant.services.complete", return_value="ok"):
            self.assertEqual(self.ask(message="a question about the app").status_code, 200)
            self.assertEqual(self.ask(message="another question here").status_code, 200)
            response = self.ask(message="a third question here")
        self.assertEqual(response.status_code, 429)
        self.assertIn("wait", response.json()["detail"].lower())

    @override_settings(
        ASSISTANT_ENABLED=True,
        ASSISTANT_API_KEY="test-key",
        ASSISTANT_BASE_URL="https://example.invalid/v1",
        ASSISTANT_MODEL="test-model",
        ASSISTANT_SESSION_BUDGET=1,
    )
    def test_budget_is_scoped_per_session(self):
        with patch("apps.assistant.services.complete", return_value="ok"):
            self.assertEqual(
                self.client.post(
                    reverse("assistant-ask"),
                    {"message": "question one here", "session_id": "session-a"},
                    content_type="application/json",
                ).status_code,
                200,
            )
            self.assertEqual(
                self.client.post(
                    reverse("assistant-ask"),
                    {"message": "question two here", "session_id": "session-b"},
                    content_type="application/json",
                ).status_code,
                200,
            )

    def test_history_is_capped_before_reaching_the_model(self):
        turns = [{"role": "user", "content": f"turn {index}"} for index in range(10)]
        response = self.ask(message="what is e-boses", history=turns)
        self.assertEqual(response.status_code, 200)


class StripMarkdownTests(TestCase):
    def test_fenced_blocks_are_removed(self):
        self.assertEqual(services.strip_markdown("before\n```py\nx=1\n```\nafter"), "before\n\nafter")

    def test_numbered_steps_survive(self):
        text = "Do this.\n1. First step\n2. Second step"
        self.assertEqual(services.strip_markdown(text), text)

    def test_bullets_are_normalised(self):
        self.assertEqual(services.strip_markdown("+ one\n- two"), "- one\n- two")
