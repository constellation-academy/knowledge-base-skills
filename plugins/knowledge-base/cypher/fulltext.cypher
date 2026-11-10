CREATE FULLTEXT INDEX kb_fulltext IF NOT EXISTS
FOR (d:Doc) ON EACH [d.title, d.body]
OPTIONS {indexConfig: {`fulltext.analyzer`: $analyzer}};
CREATE INDEX kb_doc_path IF NOT EXISTS FOR (d:Doc) ON (d.kb, d.path);
