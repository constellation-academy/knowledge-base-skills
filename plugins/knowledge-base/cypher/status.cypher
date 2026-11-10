MATCH (n) WITH collect(DISTINCT n.kb) AS kbs, count(CASE WHEN n.kb IS NULL THEN 1 END) AS unstamped
CALL apoc.util.validate(unstamped > 0 OR any(k IN kbs WHERE k <> $kb), 'refusing: the store does not hold only KB %s (other KBs: %s, unstamped nodes: %s)', [$kb, apoc.text.join([k IN kbs WHERE k <> $kb], ', '), toString(unstamped)])
OPTIONAL MATCH (i:KBIndex {kb: $kb})
RETURN apoc.convert.toJson(CASE WHEN i IS NULL THEN {kb: $kb, empty: true} ELSE {kb: i.kb, sha: i.sha, docs: i.docs} END) AS json;
