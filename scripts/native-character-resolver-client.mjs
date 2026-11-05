/** Read-only adapter for the existing character resolver on one native database transaction. */
const columns = {
  "public.style_groups": new Set([
    "id",
    "sku",
    "licensor_id",
    "property_id",
    "is_licensed",
  ]),
  "core.property": new Set(["id", "licensor_id"]),
  "core.licensor": new Set(["id", "code"]),
  "core.character": new Set(["id", "name", "status", "licensor_id"]),
  "core.character_alias": new Set(["alias", "character_id", "licensor_id"]),
};
export function nativeCharacterResolverClient(connection, trace = []) {
  function from(schema, table) {
    const key = schema + "." + table,
      allowed = columns[key];
    if (!allowed) throw Error("Resolver table refused");
    let selected = "*",
      filters = [],
      sort = null,
      bound = null,
      singular = false;
    function column(name) {
      if (!allowed.has(name)) throw Error("Resolver column refused");
      return 'r."' + name + '"';
    }
    const builder = {
      select(value) {
        selected = value;
        return builder;
      },
      eq(name, value) {
        column(name);
        filters.push({ name, operator: "=", value });
        return builder;
      },
      ilike(name, value) {
        column(name);
        filters.push({ name, operator: "ilike", value });
        return builder;
      },
      in(name, value) {
        column(name);
        if (!Array.isArray(value)) throw Error("Resolver array required");
        filters.push({ name, operator: "in", value });
        return builder;
      },
      order(name, options = {}) {
        column(name);
        sort = { name, ascending: options.ascending !== false };
        return builder;
      },
      limit(value) {
        if (!Number.isInteger(value) || value < 1 || value > 401)
          throw Error("Resolver bound refused");
        bound = value;
        return builder;
      },
      maybeSingle() {
        singular = true;
        return builder;
      },
      then(resolve, reject) {
        return run().then(resolve, reject);
      },
    };
    async function run() {
      let projection,
        join = "";
      if (
        selected === "alias, character:character_id(id, status)" ||
        selected === "alias,character:character_id(id,status)"
      ) {
        if (key !== "core.character_alias")
          throw Error("Resolver relation refused");
        projection = `r.alias, case when c.id is null then null else jsonb_build_object('id',c.id,'status',c.status) end as character`;
        join = " left join core.character c on c.id=r.character_id";
      } else {
        projection = selected
          .split(",")
          .map((name) => column(name.trim()))
          .join(",");
      }
      const parameters = [];
      const where = filters.map((filter) => {
        parameters.push(filter.value);
        return filter.operator === "in"
          ? `${column(filter.name)}=any($${parameters.length}::uuid[])`
          : `${column(filter.name)} ${filter.operator} $${parameters.length}`;
      });
      const sql = `select ${projection} from "${schema}"."${table}" r${join}${where.length ? " where " + where.join(" and ") : ""}${sort ? " order by " + column(sort.name) + (sort.ascending ? " asc" : " desc") : ""}${bound ? " limit " + bound : ""}`;
      const result = await connection.query(sql, parameters);
      const data = singular ? (result.rows[0] ?? null) : result.rows;
      if (singular && result.rows.length > 1)
        throw Error("Resolver singular read ambiguous");
      trace.push({ schema, table, selected, filters, sort, bound, data });
      return { data, error: null };
    }
    return builder;
  }
  return {
    from: (table) => from("public", table),
    schema: (schema) => ({ from: (table) => from(schema, table) }),
  };
}
