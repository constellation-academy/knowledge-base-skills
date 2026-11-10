CREATE FULLTEXT INDEX kb_fulltext IF NOT EXISTS
FOR (d:Doc) ON EACH [d.title, d.body]
OPTIONS {indexConfig: {`fulltext.analyzer`: $analyzer}};
DROP INDEX kb_doc_path IF EXISTS;
CREATE CONSTRAINT kb_doc_unique IF NOT EXISTS FOR (d:Doc) REQUIRE (d.kb, d.path) IS UNIQUE;
CREATE CONSTRAINT kb_index_unique IF NOT EXISTS FOR (i:KBIndex) REQUIRE i.kb IS UNIQUE;
