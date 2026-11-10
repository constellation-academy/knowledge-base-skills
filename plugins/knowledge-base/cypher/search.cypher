MATCH (n) WITH collect(DISTINCT n.kb) AS kbs, count(CASE WHEN n.kb IS NULL THEN 1 END) AS unstamped
CALL apoc.util.validate(unstamped > 0 OR any(k IN kbs WHERE k <> $kb), 'refusing: the store does not hold only KB %s (other KBs: %s, unstamped nodes: %s)', [$kb, apoc.text.join([k IN kbs WHERE k <> $kb], ', '), toString(unstamped)])
CALL db.index.fulltext.queryNodes('kb_fulltext', $query) YIELD node, score
WHERE node.kb = $kb
WITH node, score ORDER BY score DESC, node.path LIMIT toInteger($limit)
RETURN apoc.convert.toJson({path: node.path, title: node.title, score: score, excerpt: substring(trim(apoc.text.replace(node.body, '\\s+', ' ')), 0, 200)}) AS json;
