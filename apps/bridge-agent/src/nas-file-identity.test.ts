import assert from "node:assert/strict";
import { test } from "node:test";
import { inodeKey, volumeKeyOf } from "./nas-file-identity.js";

test("volume key is the mount root's share name", () => {
  assert.equal(volumeKeyOf("/mnt/nas/mac"), "mac");
  assert.equal(volumeKeyOf("/mnt/nas/mac/"), "mac");
  assert.equal(volumeKeyOf("/volume1/mac"), "mac");
  assert.equal(volumeKeyOf("mac"), "mac");
});

test("inode key is a decimal string, safe past 2^53", () => {
  assert.equal(inodeKey(12345n), "12345");
  assert.equal(inodeKey(9007199254740993n), "9007199254740993");
  assert.equal(inodeKey(42), "42");
  assert.equal(inodeKey("123456789012345"), "123456789012345");
  assert.equal(inodeKey(null), null);
  assert.equal(inodeKey(undefined), null);
  assert.equal(inodeKey("not-a-number"), null);
});
