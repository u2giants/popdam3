import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { matchSmbName, normalizeSmbName } from "./smb-resolve";

describe("normalizeSmbName", () => {
  it("maps catia private-use quotes to ASCII", () => {
    assert.equal(normalizeSmbName("10Wall.psd"), '10"Wall.psd');
  });
});

describe("matchSmbName", () => {
  it("matches a catia-listed name to the database name with a quote", () => {
    assert.equal(matchSmbName('10"Wall.psd', ["other.psd", "10Wall.psd"]), "10Wall.psd");
  });

  it("matches a name listed with the quote removed when that is unique", () => {
    assert.equal(matchSmbName('10"Wall.psd', ["10Wall.psd"]), "10Wall.psd");
  });

  it("returns null when nothing matches", () => {
    assert.equal(matchSmbName('10"Wall.psd', ["9Wall.psd"]), null);
  });

  it("returns null when two listed names are ambiguous", () => {
    assert.equal(matchSmbName('10"Wall.psd', ["10Wall.psd", '10"Wall.psd']), null);
  });
});
