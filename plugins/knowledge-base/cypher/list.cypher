MATCH (n) WITH collect(DISTINCT n.kb) AS kbs, count(CASE WHEN n.kb IS NULL THEN 1 END) AS unstamped
CALL apoc.util.validate(unstamped > 0 OR any(k IN kbs WHERE k <> $kb), 'refusing: the store does not hold only KB %s (other KBs: %s, unstamped nodes: %s)', [$kb, apoc.text.join([k IN kbs WHERE k <> $kb], ', '), toString(unstamped)])
MATCH (d:Doc {kb: $kb})
WHERE $type IS NULL OR d.type = $type
WITH d ORDER BY d.path
RETURN apoc.convert.toJson({path: d.path, type: d.type, title: d.title, description: d.description, status: d.status, tags: d.tags, refs: COLLECT { MATCH (d)-[:REFERENCES]->(r:Doc) RETURN r.path ORDER BY r.path }, supersedes: COLLECT { MATCH (d)-[:SUPERSEDES]->(s:Doc) RETURN s.path ORDER BY s.path }, parts: d.parts, extra: apoc.convert.fromJsonMap(d.extra)}) AS json;
