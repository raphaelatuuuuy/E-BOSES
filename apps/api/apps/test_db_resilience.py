"""retry_on_db_blip: one reconnect-and-retry on pooler blips only."""

from django.db.utils import OperationalError
from django.test import TestCase

from apps.db_resilience import retry_on_db_blip


def _blip(message="SSL error: unexpected eof while reading"):
    return OperationalError(message)


class RetryOnDbBlipTests(TestCase):
    def test_success_needs_no_retry(self):
        calls = []

        @retry_on_db_blip
        def work():
            calls.append(1)
            return "ok"

        self.assertEqual(work(), "ok")
        self.assertEqual(len(calls), 1)

    def test_single_blip_is_retried_on_a_fresh_connection(self):
        calls = []

        @retry_on_db_blip
        def work():
            calls.append(1)
            if len(calls) == 1:
                raise _blip()
            return "recovered"

        self.assertEqual(work(), "recovered")
        self.assertEqual(len(calls), 2)

    def test_persistent_blip_still_raises(self):
        @retry_on_db_blip
        def work():
            raise _blip("timeout expired")

        with self.assertRaises(OperationalError):
            work()

    def test_non_blip_errors_are_never_retried(self):
        calls = []

        @retry_on_db_blip
        def work():
            calls.append(1)
            raise ValueError("bug")

        with self.assertRaises(ValueError):
            work()
        self.assertEqual(len(calls), 1)
