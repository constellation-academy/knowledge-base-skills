MATCH (n) WITH collect(DISTINCT n.kb) AS kbs, count(CASE WHEN n.kb IS NULL THEN 1 END) AS unstamped
CALL apoc.util.validate(unstamped > 0 OR any(k IN kbs WHERE k <> $kb), 'refusing: the store does not hold only KB %s (other KBs: %s, unstamped nodes: %s)', [$kb, apoc.text.join([k IN kbs WHERE k <> $kb], ', '), toString(unstamped)])
MATCH (d:Doc {kb: $kb, path: $path})
RETURN apoc.convert.toJson({path: d.path, type: d.type, title: d.title, description: d.description, status: d.status, tags: d.tags, refs: [(d)-[:REFERENCES]->(r:Doc) | r.path], supersedes: [(d)-[:SUPERSEDES]->(s:Doc) | s.path], parts: d.parts, extra: apoc.convert.fromJsonMap(d.extra)}) AS json;
