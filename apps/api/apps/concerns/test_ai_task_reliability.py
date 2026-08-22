from tempfile import NamedTemporaryFile
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings

from apps.concerns.models import Concern, ConcernAiAssessment
from apps.concerns.tasks import enqueue_concern_ai, process_concern_ai_task


class ConcernAiTaskReliabilityTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.resident = User.objects.create_user(
            email="ai-task-resident@example.com",
            phone_number="+639180000091",
            password="pass",
            role=User.Role.RESIDENT,
            status=User.Status.VERIFIED,
        )
        self.concern = Concern.objects.create(
            reporter=self.resident,
            title="Tambak na basura sa kanto",
            description="Maraming garbage at basura malapit sa covered court.",
            category=Concern.Category.ENVIRONMENT,
        )
        ConcernAiAssessment.objects.create(
            concern=self.concern,
            status=ConcernAiAssessment.Status.PENDING,
        )

    @override_settings(EBOSES_YOLO_MODEL_PATH="")
    def test_uncaught_pipeline_failure_is_persisted_as_retryable_run_evidence(self):
        with patch(
            "apps.concerns.ai.process_concern_ai",
            side_effect=RuntimeError("simulated NLP crash"),
        ):
            with self.assertRaisesRegex(RuntimeError, "simulated NLP crash"):
                process_concern_ai_task.run(self.concern.pk)

        assessment = ConcernAiAssessment.objects.get(concern=self.concern)
        execution = assessment.raw_result["execution"]
        self.assertEqual(assessment.status, ConcernAiAssessment.Status.FAILED)
        self.assertEqual(execution["state"], "failed")
        self.assertEqual(execution["attempt_count"], 1)
        self.assertEqual(execution["last_failure"]["error_type"], "RuntimeError")
        self.assertFalse(execution["last_failure"]["retryable"])
        self.assertTrue(execution["started_at"])
        self.assertTrue(execution["finished_at"])

    @override_settings(EBOSES_YOLO_MODEL_PATH="")
    def test_later_success_records_recovery_without_losing_failure_evidence(self):
        with patch(
            "apps.concerns.ai.process_concern_ai",
            side_effect=RuntimeError("simulated NLP crash"),
        ):
            with self.assertRaises(RuntimeError):
                process_concern_ai_task.run(self.concern.pk)

        with NamedTemporaryFile(suffix=".pt") as model_file:
            with self.settings(EBOSES_YOLO_MODEL_PATH=model_file.name):
                result = process_concern_ai_task.run(self.concern.pk)

        assessment = ConcernAiAssessment.objects.get(concern=self.concern)
        execution = assessment.raw_result["execution"]
        self.assertEqual(assessment.status, ConcernAiAssessment.Status.COMPLETED)
        self.assertFalse(result["skipped"])
        self.assertEqual(execution["state"], "finished")
        self.assertEqual(execution["attempt_count"], 2)
        self.assertTrue(execution["recovered_from_failure"])
        self.assertEqual(execution["last_failure"]["error_type"], "RuntimeError")
        self.assertEqual(execution["result_status"], ConcernAiAssessment.Status.COMPLETED)

    def test_duplicate_delivery_skips_an_already_completed_model_run(self):
        with NamedTemporaryFile(suffix=".pt") as model_file:
            with self.settings(EBOSES_YOLO_MODEL_PATH=model_file.name):
                first = process_concern_ai_task.run(self.concern.pk)
                second = process_concern_ai_task.run(self.concern.pk)

        assessment = ConcernAiAssessment.objects.get(concern=self.concern)
        execution = assessment.raw_result["execution"]
        self.assertFalse(first["skipped"])
        self.assertTrue(second["skipped"])
        self.assertEqual(second["skip_reason"], "already_completed")
        self.assertEqual(execution["attempt_count"], 1)

    @override_settings(IS_LOCAL_DEVELOPMENT=False)
    def test_broker_outage_leaves_the_assessment_pending_for_the_recovery_sweep(self):
        with patch.object(process_concern_ai_task, "delay", side_effect=OSError("broker unavailable")):
            result = enqueue_concern_ai(self.concern.pk)

        self.assertIsNone(result)
        assessment = ConcernAiAssessment.objects.get(concern=self.concern)
        self.assertEqual(assessment.status, ConcernAiAssessment.Status.PENDING)
        self.assertNotIn("execution", assessment.raw_result)

    @override_settings(IS_LOCAL_DEVELOPMENT=False)
    def test_completed_assessments_are_never_reset_by_a_broker_outage(self):
        with NamedTemporaryFile(suffix=".pt") as model_file:
            with self.settings(EBOSES_YOLO_MODEL_PATH=model_file.name):
                process_concern_ai_task.run(self.concern.pk)
        with patch.object(process_concern_ai_task, "delay", side_effect=OSError("broker unavailable")):
            enqueue_concern_ai(self.concern.pk)

        assessment = ConcernAiAssessment.objects.get(concern=self.concern)
        self.assertEqual(assessment.status, ConcernAiAssessment.Status.COMPLETED)

    @override_settings(IS_LOCAL_DEVELOPMENT=True, EBOSES_YOLO_MODEL_PATH="")
    def test_dev_broker_fallback_still_uses_the_audited_execution_path(self):
        with patch.object(process_concern_ai_task, "delay", side_effect=OSError("broker unavailable")):
            result = enqueue_concern_ai(self.concern.pk)

        assessment = ConcernAiAssessment.objects.get(concern=self.concern)
        execution = assessment.raw_result["execution"]
        self.assertFalse(result["skipped"])
        self.assertEqual(execution["state"], "finished")
        self.assertEqual(execution["attempt_count"], 1)
        self.assertEqual(execution["result_status"], assessment.status)
