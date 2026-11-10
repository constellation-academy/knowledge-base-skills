MATCH (n) WITH collect(DISTINCT n.kb) AS kbs, count(CASE WHEN n.kb IS NULL THEN 1 END) AS unstamped
CALL apoc.util.validate(unstamped > 0 OR any(k IN kbs WHERE k <> $kb), 'refusing: the store does not hold only KB %s (other KBs: %s, unstamped nodes: %s)', [$kb, apoc.text.join([k IN kbs WHERE k <> $kb], ', '), toString(unstamped)])
WITH apoc.text.replace(trim(apoc.text.replace($query, '[\\s\\u3000\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f]+', ' ')), '([+\\-&|!(){}\\[\\]^"~*?:\\\\/])', '\\\\$1') AS escaped
WITH apoc.text.join([t IN split(escaped, ' ') | CASE WHEN t IN ['AND', 'OR', 'NOT'] THEN toLower(t) ELSE t END], ' ') AS q
WHERE q <> ''
CALL db.index.fulltext.queryNodes('kb_fulltext', q) YIELD node, score
WHERE node.kb = $kb
WITH node, score ORDER BY score DESC, node.path LIMIT toInteger($limit)
RETURN apoc.convert.toJson({path: node.path, title: node.title, score: score, excerpt: substring(trim(apoc.text.replace(node.body, '[\\s\\u3000\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f]+', ' ')), 0, 200)}) AS json;
