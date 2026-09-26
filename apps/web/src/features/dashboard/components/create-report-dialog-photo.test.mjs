import assert from "node:assert/strict"
import { test } from "node:test"

import {
  duplicatePhotoFeedback,
  duplicatePhotoFeedLocation,
  duplicatePhotoReportIssueLocation,
  isPhotoVerdictRejected,
  photoVerdictsWithWarningFallback,
  previewKindFor,
} from "./create-report-dialog-photo.ts"

test("a photo without a verdict is not marked rejected by a shared media error", () => {
  assert.equal(isPhotoVerdictRejected(undefined), false)
})

test("a photo with a non-relevant verdict is marked rejected", () => {
  assert.equal(
    isPhotoVerdictRejected({ index: 0, state: "unrelated", message: "" }),
    true
  )
})

test("friendly photo warning marks attached photos when verdict indexes are missing", () => {
  assert.deepEqual(
    photoVerdictsWithWarningFallback(
      [],
      [
        "Please remove photos that don't show the reported issue and upload clear ones.",
      ],
      2
    ),
    [
      {
        index: 0,
        state: "unrelated",
        message:
          "Please remove photos that don't show the reported issue and upload clear ones.",
      },
      {
        index: 1,
        state: "unrelated",
        message:
          "Please remove photos that don't show the reported issue and upload clear ones.",
      },
    ]
  )
})

test("friendly photo warning keeps existing specific rejected verdicts", () => {
  const verdicts = [
    {
      index: 1,
      state: "unrelated",
      message: "The photo shows a different issue.",
    },
  ]

  assert.deepEqual(
    photoVerdictsWithWarningFallback(
      verdicts,
      [
        "Please remove photos that don't show the reported issue and upload clear ones.",
      ],
      3
    ),
    verdicts
  )
})

test("duplicate photo feedback is informational for exact, perceptual, and LLM matches", () => {
  const messages = [
    "This photo was already used in another report.",
    "This image appears to have been uploaded before.",
    "Please use a different photo, this issue was already reported.",
  ]

  for (const message of messages) {
    assert.deepEqual(duplicatePhotoFeedback(message), {
      text: "Please use a different photo, this issue was already reported.",
      tone: "info",
      actionLabel: "Click to see",
    })
  }
})

test("duplicate photo feedback links to the matching concern at the top of the feed", () => {
  assert.deepEqual(duplicatePhotoFeedLocation(42), {
    pathname: "/dashboard/feed",
    search: "?highlightConcernId=42",
    state: { highlightConcernId: 42 },
  })
})

test("duplicate photo feedback links guests to the matching pin on report-issue", () => {
  assert.deepEqual(duplicatePhotoReportIssueLocation(42), {
    pathname: "/report-issue",
    search: "?highlightConcernId=42",
    state: { highlightConcernId: 42 },
  })
})

test("preview kind is image for JPEG, PNG, WEBP, and empty-type gallery picks", () => {
  for (const file of [
    { name: "a.jpg", type: "image/jpeg" },
    { name: "a.png", type: "image/png" },
    { name: "a.webp", type: "image/webp" },
    { name: "gallery-pick", type: "" },
  ]) {
    assert.equal(previewKindFor(file), "image")
  }
})

test("preview kind is heic for HEIC extension or MIME, never an <img>", () => {
  for (const file of [
    { name: "IMG_001.heic", type: "image/heic" },
    { name: "IMG_001.HEIC", type: "" },
    { name: "photo.heif", type: "image/heif" },
  ]) {
    assert.equal(previewKindFor(file), "heic")
  }
})

test("preview kind is video for video files, other for the rest", () => {
  assert.equal(
    previewKindFor({ name: "clip.mp4", type: "video/mp4" }),
    "video"
  )
  assert.equal(
    previewKindFor({ name: "doc.pdf", type: "application/pdf" }),
    "other"
  )
})
