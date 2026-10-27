import test from "node:test";
import assert from "node:assert/strict";
import { scrapedSubmissionsSql, buildSql, parseResult, summarize } from "./check-coldlion-property-scrape-names.mjs";

const DEF = `create or replace function api.db_data_admin_scraped_source_inventory(...)
begin
  if v_entity_kind = 'property' then
    with source_rows as (select 1), keyed as (select 'x' as licensor_name, 'A' as display_label, 'Submissions' as source_purpose
    ), filtered as (select * from keyed where p_search is null)
  end if;
end;`;

test("extractor cuts the property branch at filtered and adds Warner catalogue names", () => {
  const sql = scrapedSubmissionsSql(DEF);
  assert.match(sql, /^with source_rows/);
  assert.doesNotMatch(sql, /filtered|p_search/);
  assert.match(sql, /warner_product_catalogue/);
  assert.match(buildSql(DEF), /^select json_build_object\(/);
  assert.doesNotMatch(buildSql(DEF), /\b(insert|update|delete|begin)\b/i);
});

test("extractor fails closed when anchors or argument-free CTEs are missing", () => {
  assert.throws(() => scrapedSubmissionsSql("no branch here"), /property branch not found/);
  assert.throws(() => scrapedSubmissionsSql(DEF.replace("), filtered as (", ")")), /anchors not found/);
  assert.throws(() => scrapedSubmissionsSql(DEF.replace("select 1", "select p_cursor")), /function arguments/);
});

test("parseResult accepts CLI array and envelope forms", () => {
  assert.deepEqual(parseResult('[{"result":{"a":1}}]'), { a: 1 });
  assert.deepEqual(parseResult('{"rows":[{"result":"{\\"a\\":2}"}]}'), { a: 2 });
  assert.throws(() => parseResult("[]"), /no result row/);
});

test("summarize counts and reports codes, never names", () => {
  const s = summarize({
    scraped: [{ display_label: "Coco" }, { display_label: "Where's Wally  - LITERARY" }],
    coldlion: [
      { mg_code: "CC", name: "Coco" },
      { mg_code: "WA", name: "Where’s Wally - LITERARY’" },
      { mg_code: "PF", name: "Paul Frank" },
      { mg_code: "DY1", name: "" },
    ],
  });
  assert.equal(s.exact, 1);
  assert.equal(s.loose, 1);
  assert.equal(s.unmatched, 2);
  assert.deepEqual(s.blankNameCodes, ["DY1"]);
  assert.doesNotMatch(JSON.stringify(s), /Coco|Wally|Paul/);
  assert.throws(() => summarize({ scraped: [], coldlion: [] }), /empty/);
});
