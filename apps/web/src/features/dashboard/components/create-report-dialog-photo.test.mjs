import assert from "node:assert/strict"
import { test } from "node:test"

import { isPhotoVerdictRejected } from "./create-report-dialog-photo.ts"

test("a photo without a verdict is not marked rejected by a shared media error", () => {
  assert.equal(isPhotoVerdictRejected(undefined), false)
})

test("a photo with a non-relevant verdict is marked rejected", () => {
  assert.equal(
    isPhotoVerdictRejected({ index: 0, state: "unrelated", message: "" }),
    true
  )
})
