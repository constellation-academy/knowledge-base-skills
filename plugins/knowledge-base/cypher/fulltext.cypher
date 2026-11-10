CREATE FULLTEXT INDEX kb_fulltext IF NOT EXISTS
FOR (d:Doc) ON EACH [d.title, d.body]
OPTIONS {indexConfig: {`fulltext.analyzer`: $analyzer}};
