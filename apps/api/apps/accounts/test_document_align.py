"""Putting a submitted ID into the frame its field regions were drawn in.

The failure this exists to stop: a resident photographs a landscape barangay ID
holding the phone upright, so the card lands sideways, smaller, and off-centre
compared with the flat sample an official uploaded in Mark Areas. Every region
box is a fraction of that sample. Applied to the photo unchanged, the box
labelled "Full Name" lands on the gender line and the name comes back "MALE".

So the tests below are geometric, not textual: does the same card, moved, do
what the region boxes need — land back where the sample put it — and does a
*different* card refuse to.
"""

import cv2
import numpy as np
from django.test import TestCase

from apps.accounts.document_align import align_bytes_to_sample

CARD_LINES = [
    "BARANGAY MARIKINA HEIGHTS",
    "Identification Card",
    "LATOY, RAPHAEL ANDREI",
    "21-A MALIPAJO ST.",
    "BIRTHDATE JULY 24 2004",
    "GENDER MALE",
    "MH2025-10296",
]


def card_image(lines=None, seed=7) -> np.ndarray:
    """A flat 800x500 card: printed lines plus a portrait box of fixed noise."""
    rng = np.random.default_rng(seed)
    card = np.full((500, 800, 3), 245, np.uint8)
    for index, text in enumerate(lines or CARD_LINES):
        cv2.putText(
            card, text, (30, 60 + index * 60), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (20, 20, 60), 2
        )
    cv2.rectangle(card, (600, 40), (770, 240), (30, 30, 30), 2)
    card[45:235, 605:765] = rng.integers(60, 200, (190, 160, 3), dtype=np.uint8)
    return card


def phone_photo(card: np.ndarray, *, quarter_turn=True) -> np.ndarray:
    """The same card as a phone would capture it: turned, shrunk, off-centre, soft."""
    image = cv2.rotate(card, cv2.ROTATE_90_CLOCKWISE) if quarter_turn else card
    scene = np.full((1600, 1200, 3), 18, np.uint8)
    height, width = (990, 620) if quarter_turn else (560, 890)
    resized = cv2.resize(image, (width, height))
    top, left = 300, 280
    scene[top : top + height, left : left + width] = resized
    return cv2.GaussianBlur(scene, (0, 0), 1.2)


def encode(image: np.ndarray) -> bytes:
    ok, buffer = cv2.imencode(".jpg", image)
    assert ok
    return buffer.tobytes()


class AlignToSampleTests(TestCase):
    def test_a_sideways_phone_photo_lands_back_in_the_samples_frame(self):
        sample = card_image()
        aligned, meta = align_bytes_to_sample(encode(phone_photo(sample)), encode(sample))

        self.assertTrue(meta["aligned"], meta)
        result = cv2.imdecode(np.frombuffer(aligned, np.uint8), cv2.IMREAD_COLOR)
        self.assertEqual(result.shape[:2], sample.shape[:2])
        # Region boxes are fractions of this frame, so what matters is that the
        # card's content sits where the sample put it, not that pixels match.
        difference = cv2.absdiff(
            cv2.cvtColor(result, cv2.COLOR_BGR2GRAY),
            cv2.cvtColor(sample, cv2.COLOR_BGR2GRAY),
        )
        self.assertLess(float(difference.mean()), 25.0)

    def test_a_straight_but_smaller_photo_is_also_rescaled_to_the_frame(self):
        sample = card_image()
        aligned, meta = align_bytes_to_sample(
            encode(phone_photo(sample, quarter_turn=False)), encode(sample)
        )
        self.assertTrue(meta["aligned"], meta)
        result = cv2.imdecode(np.frombuffer(aligned, np.uint8), cv2.IMREAD_COLOR)
        self.assertEqual(result.shape[:2], sample.shape[:2])

    def test_a_different_document_is_left_alone_rather_than_forced_to_fit(self):
        """A wrong warp is worse than none: it moves every region at once."""
        sample = card_image()
        other = card_image(
            lines=["CITY OF PASIG", "Voter Certification", "PRECINCT 0421-B"], seed=99
        )
        submitted = encode(phone_photo(other))

        aligned, meta = align_bytes_to_sample(submitted, encode(sample))
        self.assertFalse(meta["aligned"], meta)
        self.assertEqual(aligned, submitted)

    def test_undecodable_input_returns_the_bytes_untouched(self):
        aligned, meta = align_bytes_to_sample(b"not-an-image", b"also-not-an-image")
        self.assertFalse(meta["aligned"])
        self.assertEqual(meta["reason"], "decode_failed")
        self.assertEqual(aligned, b"not-an-image")
