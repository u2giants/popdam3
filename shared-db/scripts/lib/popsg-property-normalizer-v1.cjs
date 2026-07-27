"use strict";

function normalize(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[_/\\–—-]+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

module.exports = { normalize };
