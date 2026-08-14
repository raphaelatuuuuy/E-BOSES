from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from .models import (
    Concern,
    ConcernAppeal,
    ConcernAssignment,
    ConcernChatAttachment,
    ConcernChatMessage,
    ConcernClarification,
    ConcernOfficialRemark,
    ConcernResolutionEvidence,
    ConcernStatusEvent,
)


class ConcernConversationContractTests(APITestCase):
    def setUp(self):
        User = get_user_model()
        self.owner = User.objects.create_user(
            email="conversation-owner@example.com",
            phone_number="+639170001001",
            password="pass",
            status=User.Status.VERIFIED,
        )
        self.other = User.objects.create_user(
            email="conversation-other@example.com",
            phone_number="+639170001002",
            password="pass",
            status=User.Status.VERIFIED,
        )
        self.official = User.objects.create_user(
            email="conversation-official@example.com",
            phone_number="+639170001003",
            password="pass",
            role=User.Role.BARANGAY_OFFICIAL,
            status=User.Status.VERIFIED,
        )
        self.responder = User.objects.create_user(
            email="conversation-responder@example.com",
            phone_number="+639170001004",
            password="pass",
            role=User.Role.FIRST_RESPONDER,
            responder_unit=User.ResponderUnit.TANOD,
            status=User.Status.VERIFIED,
            is_on_duty=True,
        )
        self.concern = Concern.objects.create(
            reporter=self.owner,
            title="Blocked drainage near the covered court",
            description="The drainage is blocked and overflowing beside the covered court.",
            category=Concern.Category.INFRASTRUCTURE,
            visibility=Concern.Visibility.COMMUNITY,
            validation_status=Concern.ValidationStatus.ACCEPTED,
            status=Concern.Status.APPEALED,
        )
        base = timezone.now() - timedelta(hours=2)
        event = ConcernStatusEvent.objects.create(
            concern=self.concern,
            status=Concern.Status.UNDER_REVIEW,
            note="Official review started.",
            actor=self.official,
        )
        message = ConcernChatMessage.objects.create(
            concern=self.concern,
            sender=self.owner,
            body="The water level is still rising.",
        )
        ConcernChatAttachment.objects.create(
            concern=self.concern,
            message=message,
            file=SimpleUploadedFile("drainage.jpg", b"private-image", content_type="image/jpeg"),
            original_filename="drainage.jpg",
            mime_type="image/jpeg",
            kind=ConcernChatAttachment.Kind.IMAGE,
            file_size=13,
        )
        clarification = ConcernClarification.objects.create(
            concern=self.concern,
            requested_by=self.official,
            request_text="Is the road still passable?",
            response_text="Only motorcycles can pass now.",
            responded_by=self.owner,
            status=ConcernClarification.Status.ANSWERED,
            responded_at=base + timedelta(minutes=40),
        )
        ConcernOfficialRemark.objects.create(
            concern=self.concern,
            author=self.official,
            body="Resident-visible dispatch update.",
            visible_to_resident=True,
        )
        ConcernOfficialRemark.objects.create(
            concern=self.concern,
            author=self.official,
            body="Internal administrative note.",
            visible_to_resident=False,
        )
        appeal = ConcernAppeal.objects.create(
            concern=self.concern,
            appellant=self.owner,
            reason="The flooding remained unresolved after the rejection.",
            status=ConcernAppeal.Status.APPROVED,
            decision_note="Reopened for field inspection.",
            reviewed_by=self.official,
            decided_at=base + timedelta(minutes=70),
        )
        assignment = ConcernAssignment.objects.create(
            concern=self.concern,
            assignee=self.responder,
            assigned_by=self.official,
            office="Public Safety Desk",
            note="Inspect the drainage and coordinate access.",
            status=ConcernAssignment.Status.ACTIVE,
        )
        ConcernResolutionEvidence.objects.create(
            concern=self.concern,
            file=SimpleUploadedFile("resolved.jpg", b"resolution", content_type="image/jpeg"),
            uploaded_by=self.official,
            original_filename="resolved.jpg",
            mime_type="image/jpeg",
            file_size=10,
            note="Drainage cleared.",
        )
        # Make ordering deterministic across event types.
        ConcernStatusEvent.objects.filter(pk=event.pk).update(created_at=base)
        ConcernChatMessage.objects.filter(pk=message.pk).update(created_at=base + timedelta(minutes=10))
        ConcernClarification.objects.filter(pk=clarification.pk).update(created_at=base + timedelta(minutes=20))
        ConcernAssignment.objects.filter(pk=assignment.pk).update(created_at=base + timedelta(minutes=30))
        ConcernAppeal.objects.filter(pk=appeal.pk).update(created_at=base + timedelta(minutes=60))

    def detail_as(self, user):
        self.client.force_authenticate(user)
        return self.client.get(f"/api/concerns/{self.concern.pk}/")

    def test_conversation_is_chronological_and_role_scoped(self):
        owner_response = self.detail_as(self.owner)
        official_response = self.detail_as(self.official)
        responder_response = self.detail_as(self.responder)

        self.assertEqual(owner_response.status_code, status.HTTP_200_OK)
        owner_items = owner_response.data["conversation"]
        self.assertEqual(
            [item["created_at"] for item in owner_items],
            sorted(item["created_at"] for item in owner_items),
        )
        self.assertIn("status", {item["kind"] for item in owner_items})
        self.assertIn("chat", {item["kind"] for item in owner_items})
        self.assertIn("assignment", {item["kind"] for item in owner_items})
        self.assertIn("clarification", {item["kind"] for item in owner_items})
        self.assertIn("official_remark", {item["kind"] for item in owner_items})
        self.assertIn("appeal", {item["kind"] for item in owner_items})
        self.assertTrue(next(item for item in owner_items if item["kind"] == "chat")["attachments"])
        assignment_item = next(item for item in owner_items if item["kind"] == "assignment")
        self.assertEqual(assignment_item["status"], ConcernAssignment.Status.ACTIVE)
        self.assertEqual(assignment_item["metadata"]["assignee_id"], self.responder.pk)
        self.assertIn("Public Safety Desk", assignment_item["body"])
        self.assertNotIn("Internal administrative note.", [item["body"] for item in owner_items])

        official_items = official_response.data["conversation"]
        self.assertIn("Internal administrative note.", [item["body"] for item in official_items])

        responder_items = responder_response.data["conversation"]
        self.assertIn("The water level is still rising.", [item["body"] for item in responder_items])
        self.assertIn("assignment", {item["kind"] for item in responder_items})
        self.assertNotIn("appeal", {item["kind"] for item in responder_items})
        self.assertNotIn("Internal administrative note.", [item["body"] for item in responder_items])

    def test_unrelated_community_viewer_cannot_receive_private_case_fields(self):
        response = self.detail_as(self.other)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["conversation"], [])
        self.assertEqual(response.data["assignments"], [])
        self.assertEqual(response.data["clarifications"], [])
        self.assertEqual(response.data["appeals"], [])
        self.assertEqual(response.data["official_remarks"], [])
        self.assertEqual(response.data["resolution_evidence"], [])

        assignment = self.concern.assignments.get(assignee=self.responder)
        assignment.status = ConcernAssignment.Status.CANCELLED
        assignment.save(update_fields=["status", "updated_at"])
        revoked_response = self.detail_as(self.responder)
        self.assertEqual(revoked_response.status_code, status.HTTP_200_OK)
        self.assertEqual(revoked_response.data["conversation"], [])

    def test_assignment_end_is_appended_to_owner_and_official_history(self):
        assignment = self.concern.assignments.get(assignee=self.responder)
        assignment.status = ConcernAssignment.Status.CANCELLED
        assignment.save(update_fields=["status", "updated_at"])

        owner_items = self.detail_as(self.owner).data["conversation"]
        official_items = self.detail_as(self.official).data["conversation"]
        owner_assignment_items = [item for item in owner_items if item["kind"] == "assignment"]
        official_assignment_items = [item for item in official_items if item["kind"] == "assignment"]

        self.assertEqual(
            [item["metadata"]["phase"] for item in owner_assignment_items],
            ["assigned", ConcernAssignment.Status.CANCELLED],
        )
        self.assertEqual(len(official_assignment_items), 2)
        self.assertIn("was cancelled", owner_assignment_items[-1]["body"])

        revoked_response = self.detail_as(self.responder)
        self.assertEqual(revoked_response.data["conversation"], [])

    def test_public_status_history_keeps_progress_but_redacts_note_and_actor(self):
        response = self.detail_as(self.other)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data["status_events"])
        self.assertEqual(response.data["status_events"][0]["status"], Concern.Status.UNDER_REVIEW)
        self.assertEqual(response.data["status_events"][0]["note"], "")
        self.assertIsNone(response.data["status_events"][0]["actor"])


class ConcernChatWebSocketTests(APITestCase):
    """The report chat live channel delivers new messages over WebSocket."""

    TEST_CHANNEL_LAYERS = {"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}

    def setUp(self):
        from django.test import override_settings

        User = get_user_model()
        self.owner = User.objects.create_user(
            email="ws-owner@example.com",
            phone_number="+639170001101",
            password="pass",
            status=User.Status.VERIFIED,
        )
        self.official = User.objects.create_user(
            email="ws-official@example.com",
            phone_number="+639170001102",
            password="pass",
            role=User.Role.BARANGAY_OFFICIAL,
            status=User.Status.VERIFIED,
        )
        self.concern = Concern.objects.create(
            reporter=self.owner,
            title="Fallen branch on the path",
            description="A large branch fell and is blocking the walking path.",
            category=Concern.Category.ENVIRONMENT,
            status=Concern.Status.UNDER_REVIEW,
        )

    def test_new_chat_message_is_broadcast_to_the_reports_channel(self):
        from unittest.mock import patch

        from django.db import connection

        def flush_on_commit():
            callbacks = list(connection.run_on_commit)
            connection.run_on_commit = []
            for _, func, _ in callbacks:
                func()

        with patch("apps.notifications.services.broadcast_concern_chat") as mock_broadcast:
            self.client.force_authenticate(self.official)
            response = self.client.post(
                f"/api/concerns/{self.concern.pk}/chat/",
                {"body": "We are on it."},
                format="json",
            )
            flush_on_commit()
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(mock_broadcast.called)
        args, _ = mock_broadcast.call_args
        self.assertEqual(args[0], self.concern.pk)
        self.assertEqual(args[1]["body"], "We are on it.")

    def test_connected_consumer_receives_messages_on_its_group(self):
        from asgiref.sync import async_to_sync
        from channels.testing import WebsocketCommunicator
        from django.test import override_settings

        from config.asgi import application
        from apps.notifications.tickets import issue_websocket_ticket

        with override_settings(CHANNEL_LAYERS=self.TEST_CHANNEL_LAYERS):
            ticket = issue_websocket_ticket(self.owner)
            communicator = WebsocketCommunicator(
                application,
                f"/ws/concerns/{self.concern.pk}/tracking/?ticket={ticket}",
            )

            def scenario():
                async def run():
                    connected, _ = await communicator.connect()
                    assert connected
                    from channels.layers import get_channel_layer

                    await get_channel_layer().group_send(
                        f"concern_{self.concern.pk}",
                        {"type": "concern.chat", "payload": {"body": "We are on it."}},
                    )
                    return await communicator.receive_json_from(timeout=5)

                return run()

            event = async_to_sync(scenario)()
            self.assertEqual(event["type"], "concern.chat")
            self.assertEqual(event["payload"]["body"], "We are on it.")

    def test_outsider_is_rejected(self):
        from asgiref.sync import async_to_sync
        from channels.testing import WebsocketCommunicator
        from django.test import override_settings

        from config.asgi import application
        from apps.notifications.tickets import issue_websocket_ticket

        User = get_user_model()
        outsider = User.objects.create_user(
            email="ws-outsider@example.com",
            phone_number="+639170001103",
            password="pass",
            status=User.Status.VERIFIED,
        )
        with override_settings(CHANNEL_LAYERS=self.TEST_CHANNEL_LAYERS):
            ticket = issue_websocket_ticket(outsider)
            communicator = WebsocketCommunicator(
                application,
                f"/ws/concerns/{self.concern.pk}/tracking/?ticket={ticket}",
            )
            connected, _ = async_to_sync(communicator.connect)()
            self.assertFalse(connected)
