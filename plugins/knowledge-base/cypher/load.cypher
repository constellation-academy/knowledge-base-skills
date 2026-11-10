:begin
CALL apoc.load.json('kb-export.json') YIELD value
CALL apoc.util.validate(value.kb IS NULL OR value.kb <> $kb, 'refusing load: the export is for KB %s, not %s', [toString(value.kb), $kb])
CALL apoc.util.validate(value.sha IS NULL OR NOT value.sha IS :: STRING OR value.sha = '', 'refusing load: the export has no sha', [])
CALL apoc.util.validate(value.docs IS NULL OR NOT value.docs IS :: LIST<ANY> OR size(value.docs) = 0, 'refusing load: the export has no docs, the existing graph is kept', [])
CALL apoc.util.validate(any(d IN value.docs WHERE NOT d IS :: MAP OR d.path IS NULL OR NOT d.path IS :: STRING OR d.path = '' OR d.title IS NULL OR NOT d.title IS :: STRING), 'refusing load: a doc in the export has no path or title', [])
CALL apoc.util.validate(any(d IN value.docs WHERE any(k IN ['type', 'description', 'status', 'body'] WHERE d[k] IS NOT NULL AND NOT d[k] IS :: STRING)), 'refusing load: type, description, status and body must be strings or null', [])
CALL apoc.util.validate(any(d IN value.docs WHERE any(k IN ['tags', 'refs', 'supersedes', 'parts'] WHERE d[k] IS NOT NULL AND NOT (d[k] IS :: LIST<STRING NOT NULL>))), 'refusing load: tags, refs, supersedes and parts must be lists of strings', [])
CALL apoc.util.validate(any(d IN value.docs WHERE d.extra IS NOT NULL AND NOT d.extra IS :: MAP), 'refusing load: extra must be an object', [])
CALL apoc.util.validate(size(apoc.coll.toSet([d IN value.docs | d.path])) <> size(value.docs), 'refusing load: the export lists a path twice', [])
CALL () {
  MATCH (n) WHERE n.kb IS NOT NULL AND n.kb <> $kb
  WITH collect(DISTINCT n.kb) AS others
  CALL apoc.util.validate(size(others) > 0, 'refusing load: the store holds another KB (%s), not %s', [apoc.text.join(others, ', '), $kb])
  FINISH
}
CALL () {
  MATCH (n) WHERE n.kb IS NULL OR NOT (n:Doc OR n:KBIndex)
  WITH count(n) AS unstamped
  CALL apoc.util.validate(unstamped > 0, 'refusing load: the store holds %s unstamped or legacy nodes that are not documents of KB %s', [toString(unstamped), $kb])
  FINISH
}
CALL () {
  MATCH (n)
  WITH count(CASE WHEN n:Doc THEN 1 END) AS docs, count(CASE WHEN n:KBIndex THEN 1 END) AS stamps
  CALL apoc.util.validate(docs > 0 AND stamps = 0, 'refusing load: the store holds documents without a KBIndex stamp for KB %s', [$kb])
  FINISH
}
CALL () { MATCH (n) DETACH DELETE n }
CALL (value) {
  UNWIND value.docs AS d
  CREATE (:Doc {
    kb: $kb, path: d.path, type: d.type, title: d.title, description: d.description,
    status: d.status, tags: coalesce(d.tags, []), parts: coalesce(d.parts, []),
    extra: apoc.convert.toJson(coalesce(d.extra, {})), body: coalesce(d.body, '')
  })
}
CALL (value) {
  UNWIND value.docs AS d
  MATCH (a:Doc {kb: $kb, path: d.path})
  UNWIND coalesce(d.refs, []) AS r
  MATCH (b:Doc {kb: $kb, path: r})
  MERGE (a)-[:REFERENCES]->(b)
}
CALL (value) {
  UNWIND value.docs AS d
  MATCH (a:Doc {kb: $kb, path: d.path})
  UNWIND coalesce(d.supersedes, []) AS s
  MATCH (b:Doc {kb: $kb, path: s})
  MERGE (a)-[:SUPERSEDES]->(b)
}
CREATE (i:KBIndex {kb: $kb, sha: value.sha, docs: size(value.docs)})
RETURN apoc.convert.toJson({kb: i.kb, sha: i.sha, docs: i.docs}) AS json;
:commit
