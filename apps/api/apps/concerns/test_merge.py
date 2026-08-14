from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APITestCase

from . import merge_services
from .models import Concern, ConcernMergeEvent, ConcernMergeSuggestion


class MergeTestBase(APITestCase):
    def setUp(self):
        User = get_user_model()
        self.resident = User.objects.create_user(
            email="merge-resident@example.com",
            phone_number="+639100000501",
            password="pass",
            status=User.Status.VERIFIED,
        )
        self.official = User.objects.create_user(
            email="merge-official@example.com",
            phone_number="+639100000502",
            password="pass",
            role=User.Role.BARANGAY_OFFICIAL,
            is_staff=True,
            status=User.Status.VERIFIED,
        )

    def make_concern(self, title, **kwargs):
        return Concern.objects.create(
            reporter=kwargs.pop("reporter", self.resident),
            title=title,
            description=kwargs.pop("description", "Something is broken."),
            **kwargs,
        )


class MergeServiceTests(MergeTestBase):
    def test_merge_points_duplicate_at_primary_and_logs_an_event(self):
        primary = self.make_concern("Broken street light")
        duplicate = self.make_concern("Street light out")

        merge_services.merge_concern(
            duplicate, primary, actor=self.official, reason="Same pole."
        )

        duplicate.refresh_from_db()
        self.assertEqual(duplicate.duplicate_of_id, primary.pk)
        event = ConcernMergeEvent.objects.get(concern=duplicate)
        self.assertEqual(event.action, ConcernMergeEvent.Action.MERGED)
        self.assertEqual(event.actor, self.official)

    def test_cannot_merge_a_report_into_itself(self):
        concern = self.make_concern("Flooding")
        with self.assertRaises(merge_services.MergeConflict):
            merge_services.merge_concern(concern, concern, actor=self.official)

    def test_merging_into_a_duplicate_follows_through_to_the_real_primary(self):
        primary = self.make_concern("Primary")
        middle = self.make_concern("Middle")
        newest = self.make_concern("Newest")

        merge_services.merge_concern(middle, primary, actor=self.official)
        merge_services.merge_concern(newest, middle, actor=self.official)

        newest.refresh_from_db()
        self.assertEqual(newest.duplicate_of_id, primary.pk)

    def test_a_primary_with_duplicates_cannot_itself_be_merged(self):
        primary = self.make_concern("Primary")
        duplicate = self.make_concern("Duplicate")
        other = self.make_concern("Other")
        merge_services.merge_concern(duplicate, primary, actor=self.official)

        with self.assertRaises(merge_services.MergeConflict):
            merge_services.merge_concern(primary, other, actor=self.official)

    def test_unmerge_clears_the_link(self):
        primary = self.make_concern("Primary")
        duplicate = self.make_concern("Duplicate")
        merge_services.merge_concern(duplicate, primary, actor=self.official)

        merge_services.unmerge_concern(duplicate, actor=self.official, reason="Different pole.")

        duplicate.refresh_from_db()
        self.assertIsNone(duplicate.duplicate_of_id)
        self.assertTrue(
            ConcernMergeEvent.objects.filter(
                concern=duplicate, action=ConcernMergeEvent.Action.UNMERGED
            ).exists()
        )

    def test_unmerge_rejects_a_report_that_is_not_merged(self):
        concern = self.make_concern("Standalone")
        with self.assertRaises(merge_services.MergeConflict):
            merge_services.unmerge_concern(concern, actor=self.official)

    def test_set_primary_repoints_the_whole_group(self):
        old_primary = self.make_concern("Old primary")
        promoted = self.make_concern("Promoted")
        sibling = self.make_concern("Sibling")
        merge_services.merge_concern(promoted, old_primary, actor=self.official)
        merge_services.merge_concern(sibling, old_primary, actor=self.official)

        merge_services.set_primary(promoted, actor=self.official)

        promoted.refresh_from_db()
        old_primary.refresh_from_db()
        sibling.refresh_from_db()
        self.assertIsNone(promoted.duplicate_of_id)
        self.assertEqual(old_primary.duplicate_of_id, promoted.pk)
        self.assertEqual(sibling.duplicate_of_id, promoted.pk)

    def test_suggestions_are_built_from_matching_fingerprints(self):
        self.make_concern("Pothole", report_fingerprint="abc123")
        self.make_concern("Pothole again", report_fingerprint="abc123")

        created = merge_services.build_merge_suggestions()

        self.assertEqual(created, 1)
        suggestion = ConcernMergeSuggestion.objects.get()
        self.assertGreaterEqual(suggestion.confidence, 0.9)
        self.assertEqual(suggestion.method, merge_services.METHOD_FINGERPRINT)

    def test_unrelated_reports_produce_no_suggestion(self):
        self.make_concern("Pothole", report_fingerprint="aaa")
        self.make_concern("Stray dog", report_fingerprint="bbb")

        self.assertEqual(merge_services.build_merge_suggestions(), 0)

    def test_building_suggestions_twice_does_not_duplicate_them(self):
        self.make_concern("Pothole", report_fingerprint="abc123")
        self.make_concern("Pothole again", report_fingerprint="abc123")

        merge_services.build_merge_suggestions()
        merge_services.build_merge_suggestions()

        self.assertEqual(ConcernMergeSuggestion.objects.count(), 1)


class MergeApiTests(MergeTestBase):
    def test_residents_cannot_list_merge_suggestions(self):
        self.client.force_authenticate(self.resident)
        response = self.client.get("/api/concerns/merge-suggestions/")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_official_sees_pending_suggestions_with_both_briefs(self):
        self.make_concern("Pothole", report_fingerprint="abc123")
        self.make_concern("Pothole again", report_fingerprint="abc123")
        merge_services.build_merge_suggestions()

        self.client.force_authenticate(self.official)
        response = self.client.get("/api/concerns/merge-suggestions/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 1)
        row = response.data[0]
        for key in ("concern", "primary", "confidence", "method", "rationale", "status"):
            self.assertIn(key, row)
        self.assertIn("tracking_id", row["concern"])
        self.assertIn("reporter_name", row["primary"])

    def test_approving_a_suggestion_merges_the_reports(self):
        primary = self.make_concern("Pothole", report_fingerprint="abc123")
        duplicate = self.make_concern("Pothole again", report_fingerprint="abc123")
        merge_services.build_merge_suggestions()
        suggestion = ConcernMergeSuggestion.objects.get()

        self.client.force_authenticate(self.official)
        response = self.client.post(
            f"/api/concerns/merge-suggestions/{suggestion.pk}/decide/",
            {"decision": "approve", "note": "Same pothole."},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        duplicate.refresh_from_db()
        self.assertEqual(duplicate.duplicate_of_id, primary.pk)
        suggestion.refresh_from_db()
        self.assertEqual(suggestion.status, ConcernMergeSuggestion.Status.ACCEPTED)

    def test_rejecting_a_suggestion_leaves_the_reports_separate(self):
        self.make_concern("Pothole", report_fingerprint="abc123")
        duplicate = self.make_concern("Pothole again", report_fingerprint="abc123")
        merge_services.build_merge_suggestions()
        suggestion = ConcernMergeSuggestion.objects.get()

        self.client.force_authenticate(self.official)
        response = self.client.post(
            f"/api/concerns/merge-suggestions/{suggestion.pk}/decide/",
            {"decision": "reject", "note": "Different street."},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        duplicate.refresh_from_db()
        self.assertIsNone(duplicate.duplicate_of_id)
        suggestion.refresh_from_db()
        self.assertEqual(suggestion.status, ConcernMergeSuggestion.Status.REJECTED)

    def test_deciding_the_same_suggestion_twice_conflicts(self):
        self.make_concern("Pothole", report_fingerprint="abc123")
        self.make_concern("Pothole again", report_fingerprint="abc123")
        merge_services.build_merge_suggestions()
        suggestion = ConcernMergeSuggestion.objects.get()

        self.client.force_authenticate(self.official)
        url = f"/api/concerns/merge-suggestions/{suggestion.pk}/decide/"
        self.client.post(url, {"decision": "approve"}, format="json")
        response = self.client.post(url, {"decision": "approve"}, format="json")

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)

    def test_manual_merge_and_unmerge_round_trip(self):
        primary = self.make_concern("Primary")
        duplicate = self.make_concern("Duplicate")
        self.client.force_authenticate(self.official)

        merged = self.client.post(
            f"/api/concerns/{duplicate.pk}/merge/",
            {"primary_id": primary.pk, "reason": "Same issue."},
            format="json",
        )
        self.assertEqual(merged.status_code, status.HTTP_200_OK)
        duplicate.refresh_from_db()
        self.assertEqual(duplicate.duplicate_of_id, primary.pk)

        separated = self.client.post(
            f"/api/concerns/{duplicate.pk}/unmerge/", {"reason": "Wrong."}, format="json"
        )
        self.assertEqual(separated.status_code, status.HTTP_200_OK)
        duplicate.refresh_from_db()
        self.assertIsNone(duplicate.duplicate_of_id)

    def test_merging_into_itself_returns_conflict_not_500(self):
        concern = self.make_concern("Only one")
        self.client.force_authenticate(self.official)
        response = self.client.post(
            f"/api/concerns/{concern.pk}/merge/",
            {"primary_id": concern.pk, "reason": ""},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)

    def test_merge_history_lists_events_newest_first(self):
        primary = self.make_concern("Primary")
        duplicate = self.make_concern("Duplicate")
        self.client.force_authenticate(self.official)
        self.client.post(
            f"/api/concerns/{duplicate.pk}/merge/",
            {"primary_id": primary.pk, "reason": "Same issue."},
            format="json",
        )
        self.client.post(
            f"/api/concerns/{duplicate.pk}/unmerge/", {"reason": "Wrong."}, format="json"
        )

        response = self.client.get(f"/api/concerns/{duplicate.pk}/merge-history/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 2)
        self.assertEqual(response.data[0]["action"], "unmerged")
        self.assertEqual(response.data[0]["primary_tracking_id"], primary.tracking_id)
        self.assertTrue(response.data[0]["actor_name"])

    def test_set_primary_endpoint_promotes_a_duplicate(self):
        primary = self.make_concern("Primary")
        duplicate = self.make_concern("Duplicate")
        self.client.force_authenticate(self.official)
        self.client.post(
            f"/api/concerns/{duplicate.pk}/merge/",
            {"primary_id": primary.pk},
            format="json",
        )

        response = self.client.post(f"/api/concerns/{duplicate.pk}/set-primary/", {}, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        duplicate.refresh_from_db()
        primary.refresh_from_db()
        self.assertIsNone(duplicate.duplicate_of_id)
        self.assertEqual(primary.duplicate_of_id, duplicate.pk)
