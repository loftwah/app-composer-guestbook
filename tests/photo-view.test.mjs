import test from "node:test";
import assert from "node:assert/strict";
import { publicPhotoView } from "../src/photo-view.ts";
test("the public view is current source data and never revives ineligible media", () => {
  const record = {
    id: "fictional-1",
    caption: "A fictional moon",
    author: "Ada",
    status: "approved",
    revision: 3,
    synthetic: 1,
  };
  const location = {
    url: "https://example.com/item/fictional-1",
    image: "https://example.com/media/fictional-1",
  };
  assert.deepEqual(publicPhotoView(record, location), {
    contract: 1,
    provider: "guestbook",
    id: record.id,
    revision: 3,
    title: record.caption,
    description: "Ada",
    visibility: "public",
    ...location,
    synthetic: true,
  });
  for (const status of ["hidden", "deleted", "pending", "rejected"])
    assert.equal(publicPhotoView({ ...record, status }, location), null);
});
