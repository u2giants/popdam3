"use strict";

const assert = require("assert");
const {
  normalize,
  csvCell,
  sharedTokenScore,
  structuralHint,
  redactedExample,
} = require("./popsg-property-psg1-inventory.cjs");

assert.equal(normalize("  Disney’s-Wish  "), "disneys wish");
assert.equal(normalize("MarvelStyleGuide"), "marvel style guide");
assert.equal(normalize("ＡＢＣ"), "abc");
assert.equal(csvCell("plain"), "plain");
assert.equal(csvCell("a,b"), '"a,b"');
assert.equal(sharedTokenScore("Batman Classic", "BATMAN"), 0.5);
assert.equal(sharedTokenScore("unrelated", "BATMAN"), 0);
assert.equal(structuralHint("2025 Style Guide"), true);
assert.equal(structuralHint("BATMAN"), false);
const redacted = redactedExample("Marvel/Batman/private/file.psd", "customer-secret.psd", "psd");
assert.match(redacted.path, /^\[redacted:[a-f0-9]{12}\]\/depth-4\/\[file\]\.psd$/);
assert.match(redacted.filename, /^\[redacted:[a-f0-9]{12}\]\.psd$/);
assert(!JSON.stringify(redacted).includes("customer-secret"));

console.log("popsg-property-psg1-inventory tests passed");
